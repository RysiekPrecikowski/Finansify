import {
  convertViaPln,
  currency as toCurrency,
  makeReadFxRates,
  makeRefreshFxRates,
  type Currency,
  type DisplayCurrencies,
  type Money,
} from '@finansify/core';
import type Decimal from 'decimal.js';

import {
  type Account,
  type Holding,
  type PortfolioSnapshot,
  type Range,
  type ValuePoint,
} from '@/lib/fixtures/portfolio';
import { clock, getFxProvider, getFxRates } from '@/server/container';

export interface ConvertedSnapshot {
  readonly snapshot: PortfolioSnapshot;
  /**
   * The portfolio total in whatever currency the **per-holding** figures ended
   * up in, which is not `snapshot.totalValue` when the lines stay native. It
   * exists so the share-of-portfolio column has a denominator in the same
   * currency as its numerator — dividing a PLN position by a CHF total is a
   * number with no meaning, and one that looks perfectly plausible on screen.
   */
  readonly holdingsTotal: Money;
  /** `false` when no rate could be obtained — the snapshot comes back in its own currency, untouched. */
  readonly converted: boolean;
}

const PLN = toCurrency('PLN');

/**
 * The dashboard's figures in the currency the reader picked.
 *
 * The numbers themselves are still `lib/fixtures/portfolio.ts` — this does not
 * make the dashboard real, and the ledger-backed version is its own piece of
 * work. But the currency switcher sits in the global header, so a reader who
 * picks EUR and watches the landing page stay in PLN has been shown a broken
 * control, not a scoping decision.
 *
 * **A missing rate converts nothing** (rule 7). There is no partial pass that
 * leaves some tiles in EUR and others in PLN, and nothing is estimated: either
 * every figure moves at one rate, or the snapshot is served exactly as it is
 * and `converted` says so.
 *
 * `display.lines` decides how far down the page the total's currency reaches.
 * The split is the one `valuePositions` already draws in `core`: the aggregate
 * — the headline, the account tiles, the chart — is summed in `display.total`
 * whatever the reader picked, while a position's own figures are the raw fact
 * and follow `display.lines`. `'native'` therefore leaves every holding in the
 * currency its instrument is priced and its cost basis kept in; a currency
 * there restates them, exactly as it restates `marketValueByCurrency`.
 *
 * The account tiles are aggregates and stay with the total, contribution
 * headroom included — an IKE limit read against a value in another currency
 * would be a comparison of two different things.
 *
 * Ratios are left alone on purpose — a gain of 10.4% is 10.4% in any currency.
 * Converting them would be arithmetic on a pure number.
 */
export async function convertSnapshot(
  snapshot: PortfolioSnapshot,
  display: DisplayCurrencies,
): Promise<ConvertedSnapshot> {
  const lines = display.lines;

  // PLN is filtered out rather than looked up: table A has no PLN row, and
  // asking for one leaves the refresh permanently due (`lib/display/server.ts`).
  // Nothing left to ask for means nothing moves, and the fixture is already
  // there.
  const targets = [
    ...new Set(lines === 'native' ? [display.total] : [display.total, lines]),
  ].filter((code) => code !== PLN);
  if (targets.length === 0) {
    return { snapshot, holdingsTotal: snapshot.totalValue, converted: true };
  }

  const rates = await ratesToPlnFor(targets);
  if (rates === null) {
    return { snapshot, holdingsTotal: snapshot.totalValue, converted: false };
  }

  const money = (amount: Money) => convertViaPln(amount, display.total, rates);
  // `'native'` is not "convert to the snapshot's own currency" but "do not
  // touch it": a holding priced in USD stays in USD even where the snapshot's
  // total is PLN, which is the whole point of the setting.
  const lineMoney =
    lines === 'native' ? null : (amount: Money) => convertViaPln(amount, lines, rates);

  return {
    converted: true,
    holdingsTotal: lineMoney === null ? snapshot.totalValue : lineMoney(snapshot.totalValue),
    snapshot: {
      ...snapshot,
      totalValue: money(snapshot.totalValue),
      totalCost: money(snapshot.totalCost),
      changeToday: money(snapshot.changeToday),
      changeTotal: money(snapshot.changeTotal),
      holdings:
        lineMoney === null
          ? snapshot.holdings
          : snapshot.holdings.map((holding) => convertHolding(holding, lineMoney)),
      accounts: snapshot.accounts.map((account) => convertAccount(account, money)),
      series: convertSeries(snapshot.series, money),
    },
  };
}

/**
 * The current mids for the currencies this render needs, refreshing table A
 * first if any of them is due — the same read-then-refresh-then-re-read the
 * positions view runs (ADR 0014). A provider failure is not thrown: it comes
 * back as `null`, which the caller renders as "not converted" rather than as
 * an error page.
 *
 * One missing currency fails the whole map, deliberately. The caller's contract
 * is all-or-nothing, and a map that is short a row would convert the totals and
 * leave the lines behind — the partial pass rule 7 exists to prevent.
 */
async function ratesToPlnFor(
  targets: readonly Currency[],
): Promise<ReadonlyMap<Currency, Decimal> | null> {
  try {
    const fx = getFxRates();
    const readFxRates = makeReadFxRates({ fx, clock });

    let lookups = await readFxRates(targets);

    if (targets.some((code) => lookups.get(code)?.status !== 'fresh')) {
      const refreshFxRates = makeRefreshFxRates({ fx, provider: getFxProvider(), clock });
      await refreshFxRates(targets);
      lookups = await readFxRates(targets);
    }

    const rates = new Map<Currency, Decimal>();
    for (const code of targets) {
      const lookup = lookups.get(code);
      if (lookup === undefined || lookup.status === 'unavailable') return null;
      rates.set(code, lookup.mid);
    }
    return rates;
  } catch {
    return null;
  }
}

/**
 * Every figure on a holding is a line figure, so all of them move together or
 * none do. `averageCost` and `cost` are its cost basis, `price` and `value` are
 * what the instrument is quoted at, and `gain` and `changeToday` are
 * differences of those — restating some but not others would put two currencies
 * in one row and a subtraction between them that no longer holds.
 */
function convertHolding(holding: Holding, money: (amount: Money) => Money): Holding {
  return {
    ...holding,
    averageCost: money(holding.averageCost),
    cost: money(holding.cost),
    valuation:
      holding.valuation === null
        ? null
        : {
            ...holding.valuation,
            price: holding.valuation.price === null ? null : money(holding.valuation.price),
            value: money(holding.valuation.value),
            gain: money(holding.valuation.gain),
            changeToday: money(holding.valuation.changeToday),
          },
  };
}

function convertAccount(account: Account, money: (amount: Money) => Money): Account {
  return {
    ...account,
    value: money(account.value),
    contribution:
      account.contribution === null
        ? null
        : {
            ...account.contribution,
            used: money(account.contribution.used),
            limit: money(account.contribution.limit),
          },
  };
}

function convertSeries(
  series: Readonly<Record<Range, readonly ValuePoint[]>>,
  money: (amount: Money) => Money,
): Readonly<Record<Range, readonly ValuePoint[]>> {
  // Rebuilt key by key rather than through `Object.entries`: the entries form
  // widens the key back to `string`, and the cast that would hide that is the
  // kind that survives a range being renamed.
  const converted = {} as Record<Range, readonly ValuePoint[]>;
  for (const range of Object.keys(series) as Range[]) {
    converted[range] = series[range].map((point) => ({ ...point, value: money(point.value) }));
  }
  return converted;
}
