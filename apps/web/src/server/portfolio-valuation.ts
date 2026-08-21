import {
  makeReadPrices,
  makeRefreshPrices,
  valuePositions,
  type CashBalanceLine,
  type Currency,
  type DisplayCurrencies,
  type FxSourcePreference,
  type InstrumentId,
  type InstrumentPosition,
  type PositionsValuation,
  type PriceLookup,
} from '@finansify/core';
import type Decimal from 'decimal.js';

import { type DisplaySettings } from '@/lib/display/currencies';
import { currenciesToRefresh, toDisplayCurrencies } from '@/lib/display/server';
import { bondPriceLookups } from '@/server/bond-valuation';
import { catalystBondPriceLookups } from '@/server/catalyst-bond-valuation';
import { clock, getMarketPrices, getPriceProviders, getSymbols } from '@/server/container';
import { readValuationRates } from '@/server/fx-rates';

export interface PortfolioValuation {
  readonly valuation: PositionsValuation;
  /** Per-instrument lookup, so a caller can tell a stale price from a never-fetched one. */
  readonly priceLookups: ReadonlyMap<InstrumentId, PriceLookup>;
  /** Mid rates to PLN, for a caller that needs to convert something `valuePositions` itself doesn't touch — cash, for instance. */
  readonly ratesToPln: ReadonlyMap<Currency, Decimal>;
}

/**
 * The one network hop `/portfolio` and `/dashboard` both wait on. Reads what's
 * stored first, refreshes only what's missing or past its TTL, then re-reads
 * (ADR 0014, section 03). A failed refresh never throws here: `refreshPrices`/
 * `refreshFxRates` already swallow provider errors into their report, so a
 * down provider degrades to "stale, with its date shown" rather than an error
 * boundary. Callers are expected to run this inside their own `<Suspense>`
 * boundary — it is the slow part of an otherwise ledger-only render.
 *
 * `displayCurrencies` defaults to `display` translated the normal way
 * (`toDisplayCurrencies`, which honors the reader's native/converted lines
 * choice) — that default is what `/portfolio` wants. `/dashboard` passes its
 * own: every row there is a single `Money`, never an array of them, so it
 * pins `lines` to `display.total` regardless of what the reader picked for
 * the detailed table.
 *
 * `cash` is required, not optional with an empty default: a caller that
 * converts cash balances into a total (`/dashboard`'s account tiles) must
 * pass them here so their currencies are actually requested, or that
 * conversion permanently fails for any currency held only as uninvested cash
 * (accumulated dividends, say) and never by a priced position — the bug this
 * parameter exists to close. A caller that never converts cash at all
 * (`/portfolio`'s total, which shows cash in its own table, unconverted)
 * passes `[]` explicitly rather than relying on a silent default.
 */
export async function valuePositionsFor(
  positions: readonly InstrumentPosition[],
  cash: readonly CashBalanceLine[],
  display: DisplaySettings,
  fxPreference: FxSourcePreference,
  displayCurrencies: DisplayCurrencies = toDisplayCurrencies(display),
): Promise<PortfolioValuation> {
  // Bonds are deliberately excluded from every price path below. Nothing
  // quotes them (ADR 0011), so asking the provider would be a guaranteed miss
  // per bond per render, and `refreshPrices` would report each one as
  // `unmapped` — which the UI renders as a defect rather than as the normal
  // state of an instrument that is valued by accrual instead.
  const quoted = positions.filter((position) => position.instrument.kind !== 'bond');
  const instrumentIds = quoted.map((position) => position.instrument.id);
  // Instrument currencies (for pricing) union cost-basis currencies (for
  // unrealized P&L) union cash-balance currencies (for a caller that converts
  // cash into a total — a currency held only as uninvested cash, never by a
  // priced position, otherwise never gets asked for) union the currency the
  // reader is totalling in — that last one need not be held by anything, and
  // without a rate for it the total is a partial sum of nothing.
  // `currenciesToRefresh` drops PLN: NBP table A has no PLN row, so including
  // it made `fxDue` permanently true and re-fetched the table on every render
  // regardless of what was actually stale.
  const currencies = currenciesToRefresh(display, [
    ...quoted.map((position) => position.instrument.currency),
    ...positions.flatMap((position) =>
      position.costBasisByCurrency.map((amount) => amount.currency),
    ),
    ...cash.map((line) => line.amount.currency),
  ]);

  const readPrices = makeReadPrices({ prices: getMarketPrices(), symbols: getSymbols(), clock });

  let priceLookups = await readPrices(instrumentIds);
  let fxLookups = await readValuationRates(currencies, fxPreference);

  const pricesDue = instrumentIds.some((id) => priceLookups.get(id)?.status !== 'fresh');
  const fxDue = currencies.some((code) => fxLookups.get(code)?.status !== 'fresh');

  if (pricesDue) {
    // No mapping pass runs here anymore: `selectInstrument` confirms and
    // saves the provider symbol at the moment an instrument is created
    // (ADR 0014), so every instrument this page can show is already
    // resolved. `refreshPrices`'s `unmapped` report exists for the read
    // path to distinguish from a merely-slow fetch, not because a mapping
    // gap is expected here.
    const refreshPrices = makeRefreshPrices({
      prices: getMarketPrices(),
      symbols: getSymbols(),
      providers: getPriceProviders(),
      clock,
    });
    const report = await refreshPrices(instrumentIds);

    // `readPrices` only ever knows "never-fetched" — it reads
    // `MarketPriceRepository` alone and has no way to tell a merely-slow fetch
    // from one that will never happen without a mapping. `refreshPrices`'s
    // report is the one place that distinction exists, so it's overlaid onto
    // a mutable copy of the fresh read.
    const withUnmapped = new Map(await readPrices(instrumentIds));
    for (const id of report.unmapped) {
      withUnmapped.set(id, { status: 'unavailable', reason: 'unmapped' });
    }
    priceLookups = withUnmapped;
  }

  if (fxDue) {
    // `readValuationRates` already refreshed if anything was due, from whichever
    // feed the reader's preference resolves to (ADR 0018). Re-reading here would
    // ask the same question twice.
    fxLookups = await readValuationRates(currencies, fxPreference);
  }

  const ratesToPln = new Map<Currency, Decimal>();
  for (const [code, lookup] of fxLookups) {
    if (lookup.status !== 'unavailable') ratesToPln.set(code, lookup.mid);
  }

  // All the Money arithmetic — market value, unrealized P&L, the portfolio total —
  // lives in `core`'s `valuePositions`, tested against fakes there.
  // Retail bond values are accrued, not fetched, and arrive as `PriceLookup`s
  // so the one valuation pipeline serves every kind — see
  // `server/bond-valuation.ts`. Catalyst bonds *are* fetched (`gpw` is already
  // in `priceLookups` above) — `catalystBondPriceLookups` only rescales the
  // quote already there by the instrument's nominal (ADR 0023).
  const withBonds = new Map(priceLookups);
  for (const [id, lookup] of await bondPriceLookups(positions)) withBonds.set(id, lookup);
  for (const [id, lookup] of await catalystBondPriceLookups(positions, priceLookups)) {
    withBonds.set(id, lookup);
  }

  const valuation = valuePositions(positions, withBonds, ratesToPln, displayCurrencies);

  return { valuation, priceLookups, ratesToPln };
}
