import {
  convertViaPln,
  currency as toCurrency,
  makeReadFxRates,
  makeRefreshFxRates,
  type Currency,
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
 * Ratios are left alone on purpose — a gain of 10.4% is 10.4% in any currency.
 * Converting them would be arithmetic on a pure number.
 */
export async function convertSnapshot(
  snapshot: PortfolioSnapshot,
  target: Currency,
): Promise<ConvertedSnapshot> {
  if (target === PLN) return { snapshot, converted: true };

  const rates = await ratesToPlnFor(target);
  if (rates === null) return { snapshot, converted: false };

  const money = (amount: Money) => convertViaPln(amount, target, rates);

  return {
    converted: true,
    snapshot: {
      ...snapshot,
      totalValue: money(snapshot.totalValue),
      totalCost: money(snapshot.totalCost),
      changeToday: money(snapshot.changeToday),
      changeTotal: money(snapshot.changeTotal),
      holdings: snapshot.holdings.map((holding) => convertHolding(holding, money)),
      accounts: snapshot.accounts.map((account) => convertAccount(account, money)),
      series: convertSeries(snapshot.series, money),
    },
  };
}

/**
 * The current mid for one currency, refreshing table A first if it is due —
 * the same read-then-refresh-then-re-read the positions view runs (ADR 0014).
 * A provider failure is not thrown: it comes back as `null`, which the caller
 * renders as "not converted" rather than as an error page.
 */
async function ratesToPlnFor(target: Currency): Promise<ReadonlyMap<Currency, Decimal> | null> {
  try {
    const fx = getFxRates();
    const readFxRates = makeReadFxRates({ fx, clock });

    let lookup = (await readFxRates([target])).get(target);

    if (lookup === undefined || lookup.status !== 'fresh') {
      const refreshFxRates = makeRefreshFxRates({ fx, provider: getFxProvider(), clock });
      await refreshFxRates([target]);
      lookup = (await readFxRates([target])).get(target);
    }

    if (lookup === undefined || lookup.status === 'unavailable') return null;
    return new Map([[target, lookup.mid]]);
  } catch {
    return null;
  }
}

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
