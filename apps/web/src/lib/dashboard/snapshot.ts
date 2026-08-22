import {
  contributionRoomFor,
  convertViaPln,
  currency as toCurrency,
  instrumentKinds,
  Money,
  publishedWrapperRules,
  UnknownFxRateError,
  UnknownWrapperRulesError,
  type Account,
  type AccountId,
  type CashBalanceLine,
  type Currency,
  type InstrumentId,
  type InstrumentKind,
  type PositionsValuation,
  type PriceLookup,
  type ValuedPosition,
  type Wrapper,
} from '@finansify/core';
import type Decimal from 'decimal.js';

const PLN = toCurrency('PLN');

/**
 * The dashboard's holdings list is a single-currency, at-a-glance summary —
 * unlike `/portfolio`'s detailed table it never shows a position split across
 * currencies, so every figure here is one `Money`, not an array of them. The
 * page gets there by calling `valuePositionsFor` with `lines` pinned to
 * `display.total` regardless of what the reader picked for `/portfolio` —
 * see `app/(app)/dashboard/page.tsx`.
 */
export const assetClasses = instrumentKinds;
export type AssetClass = InstrumentKind;

export const sortOrders = ['valueDesc', 'gainAbsoluteDesc', 'gainPercentDesc', 'nameAsc'] as const;
export type SortOrder = (typeof sortOrders)[number];

export interface DashboardHoldingValuation {
  /** `null` when nothing has priced this instrument yet (rule 7 — never an estimate). */
  readonly price: Money | null;
  readonly value: Money;
  /**
   * `null` only when the position's lots carry more than one cost-basis
   * currency — a real possibility once an instrument moves between accounts
   * in different currencies, which the single-currency demo data never
   * exercised. Rare in practice; `null` here means "no single figure", not
   * "zero".
   */
  readonly gain: Money | null;
  readonly gainRatio: string | null;
}

export interface DashboardHolding {
  readonly id: InstrumentId;
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly quantity: string;
  /** `null` when cost basis spans more than one currency — same condition as `cost`. */
  readonly averageCost: Money | null;
  readonly cost: Money | null;
  readonly valuation: DashboardHoldingValuation | null;
}

/**
 * The IKE/IKZE contribution-limit bar's numbers.
 *
 * `limit` is real: `publishedWrapperRules` transcribes it from the KNF's
 * tables, with the source recorded per row. **`used` is not.** Nothing in the
 * ledger distinguishes a contribution from a transfer or from growth inside
 * the wrapper — `docs/domain.md` puts that in `wrapper_rules` alongside a
 * per-year contribution ledger, which does not exist yet — so `used` is the
 * account's current PLN value standing in for the year's paid-in total. That
 * over-states a wrapper that has grown and under-states one that has fallen.
 *
 * It is labelled as an approximation wherever it is drawn
 * (`dashboard.accounts.limitApproximate`), the same way
 * `lib/dashboard/demo-enrichment.ts` and `news-list.tsx` label theirs. Replace
 * `used` — and only `used` — once contributions are tracked.
 */
export interface AccountContribution {
  readonly year: number;
  /** Always PLN: the statutory limit is a złoty figure, so the comparison has to happen in złoty regardless of the reader's presentation currency. */
  readonly limit: Money;
  readonly used: Money;
  /** `used / limit`, unclamped — a wrapper past its limit reports a ratio above 1 and the bar decides what to do about it. */
  readonly ratio: string;
}

export interface DashboardAccount {
  readonly id: AccountId;
  readonly name: string;
  readonly broker: string;
  readonly wrapper: Wrapper;
  /**
   * Open positions' market value plus cash, converted to the presentation
   * total. `null` when a price or an exchange rate was missing for something
   * held here — a partial number presented as a whole would be worse than no
   * number at all (rule 7).
   */
  readonly value: Money | null;
  /** `null` for an uncapped wrapper (brokerage, PPK), for a year with no published rules on file, and whenever the account's value is incomplete. */
  readonly contribution: AccountContribution | null;
}

export interface DashboardTotals {
  readonly totalValue: Money;
  readonly totalCost: Money;
  readonly changeTotal: Money;
  readonly changeTotalRatio: string;
  /** `false` when at least one position or cash balance couldn't be priced or converted — the totals above are a partial sum, not a wrong one. */
  readonly totalIsComplete: boolean;
}

/** `null` on a missing rate rather than throwing — a stray currency shouldn't blank the whole page. */
function convertOrNull(
  amount: Money,
  toCurrency: Currency,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
): Money | null {
  try {
    return convertViaPln(amount, toCurrency, ratesToPln);
  } catch (error) {
    if (error instanceof UnknownFxRateError) return null;
    throw error;
  }
}

function ratio(numerator: Money, denominator: Money): string {
  if (denominator.isZero()) return '0';
  return numerator.amount.dividedBy(denominator.amount).toFixed(6);
}

/**
 * Maps `valuePositions`' output (already priced, already converted to the
 * presentation total — see the module comment above) onto the shape the
 * dashboard's compact list renders. Pure: no I/O, no `Instant.now()`.
 */
export function buildDashboardHoldings(
  positions: readonly ValuedPosition[],
  priceLookups: ReadonlyMap<InstrumentId, PriceLookup>,
): readonly DashboardHolding[] {
  return positions.map((position): DashboardHolding => {
    const [value] = position.marketValueByCurrency;
    const [gain] = position.unrealizedByCurrency;
    const singleCostBasis =
      position.costBasisByCurrency.length === 1 ? position.costBasisByCurrency[0]! : null;
    const lookup = priceLookups.get(position.instrument.id);
    const price = lookup !== undefined && lookup.status !== 'unavailable' ? lookup.close : null;

    const valuation: DashboardHoldingValuation | null =
      value === undefined
        ? null
        : {
            price,
            value,
            gain: gain ?? null,
            gainRatio:
              gain === undefined || singleCostBasis === null || singleCostBasis.isZero()
                ? null
                : ratio(gain, singleCostBasis),
          };

    return {
      id: position.instrument.id,
      symbol: position.instrument.symbol,
      name: position.instrument.name,
      assetClass: position.instrument.kind,
      quantity: position.quantity.toFixed(),
      averageCost:
        position.averageCost === null || singleCostBasis === null
          ? null
          : Money.of(position.averageCost, singleCostBasis.currency),
      cost: singleCostBasis,
      valuation,
    };
  });
}

/**
 * Cost basis isn't summed anywhere in `core` — `valuePositions` has no reason
 * to, since `/portfolio` shows it per position, grouped by currency. The
 * dashboard's headline wants one number, so it's summed here, converted the
 * same way `totalMarketValue` already was.
 */
export function buildTotals(
  positions: readonly ValuedPosition[],
  valuation: PositionsValuation,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
  total: Currency,
): DashboardTotals {
  let totalCost = Money.zero(total);
  let costComplete = true;

  for (const position of positions) {
    for (const leg of position.costBasisByCurrency) {
      const converted = convertOrNull(leg, total, ratesToPln);
      if (converted === null) {
        costComplete = false;
        continue;
      }
      totalCost = totalCost.plus(converted);
    }
  }

  const changeTotal = valuation.totalMarketValue.minus(totalCost);

  return {
    totalValue: valuation.totalMarketValue,
    totalCost,
    changeTotal,
    changeTotalRatio: ratio(changeTotal, totalCost),
    totalIsComplete: valuation.totalIsComplete && costComplete,
  };
}

/**
 * Each account tile's value: its open positions' market value plus its cash,
 * converted to the presentation total. Grouped by account rather than by
 * wrapper — two accounts can share a wrapper, and the ledger already tells us
 * which account each line and each cash balance actually belongs to.
 */
export function buildAccountTotals(
  accounts: readonly Account[],
  positions: readonly ValuedPosition[],
  cash: readonly CashBalanceLine[],
  ratesToPln: ReadonlyMap<Currency, Decimal>,
  total: Currency,
  /**
   * The year the contribution limits are read for. Passed in rather than taken
   * from a clock here, so this function stays pure — the caller is the one
   * that already has `clock` (`server/container.ts`).
   */
  year: number,
): readonly DashboardAccount[] {
  const amountsByAccount = new Map<AccountId, Money[]>();
  // A second running total in PLN, kept alongside the presentation-currency
  // one: a contribution limit is a złoty figure, so comparing an account
  // valued in dollars against it would be comparing two different things.
  const plnByAccount = new Map<AccountId, Money[]>();
  const incomplete = new Set<AccountId>();

  const add = (accountId: AccountId, amount: Money | null) => {
    if (amount === null) {
      incomplete.add(accountId);
      return;
    }
    const converted = convertOrNull(amount, total, ratesToPln);
    const inPln = convertOrNull(amount, PLN, ratesToPln);
    if (converted === null || inPln === null) {
      incomplete.add(accountId);
      return;
    }
    const running = amountsByAccount.get(accountId);
    amountsByAccount.set(accountId, running === undefined ? [converted] : [...running, converted]);
    const runningPln = plnByAccount.get(accountId);
    plnByAccount.set(accountId, runningPln === undefined ? [inPln] : [...runningPln, inPln]);
  };

  for (const position of positions) {
    for (const line of position.lines) {
      if (line.marketValue === null) {
        if (!line.quantity.isZero()) incomplete.add(line.account.id);
        continue;
      }
      add(line.account.id, line.marketValue);
    }
  }

  for (const line of cash) {
    add(line.account.id, line.amount);
  }

  return accounts.map((account): DashboardAccount => {
    const amounts = amountsByAccount.get(account.id) ?? [];
    const value = incomplete.has(account.id)
      ? null
      : amounts.reduce((sum, amount) => sum.plus(amount), Money.zero(total));

    const usedInPln = incomplete.has(account.id)
      ? null
      : (plnByAccount.get(account.id) ?? []).reduce(
          (sum, amount) => sum.plus(amount),
          Money.zero(PLN),
        );

    return {
      id: account.id,
      name: account.name,
      broker: account.broker,
      wrapper: account.wrapper,
      value,
      contribution: usedInPln === null ? null : contributionFor(account.wrapper, year, usedInPln),
    };
  });
}

/**
 * A wrapper's limit row for `year`, or `null` when there is nothing to draw.
 *
 * `contributionRoomFor` **throws** rather than extrapolating a year it has no
 * published figure for — deliberately, per its own doc comment, because a
 * stale limit tells someone they have room they do not have. A dashboard tile
 * is not the place to surface that as an error, so a missing year drops the
 * bar and leaves the tile as it was before this existed.
 */
function contributionFor(
  wrapper: Wrapper,
  year: number,
  usedInPln: Money,
): AccountContribution | null {
  try {
    const room = contributionRoomFor(publishedWrapperRules, wrapper, year, usedInPln);
    if (room.limit === null || room.limit.isZero()) return null;
    return {
      year,
      limit: room.limit,
      used: usedInPln,
      ratio: usedInPln.amount.dividedBy(room.limit.amount).toFixed(6),
    };
  } catch (error) {
    if (error instanceof UnknownWrapperRulesError) return null;
    throw error;
  }
}

export function filterByAssetClass(
  input: readonly DashboardHolding[],
  assetClass: AssetClass | null,
): readonly DashboardHolding[] {
  return assetClass === null ? input : input.filter((holding) => holding.assetClass === assetClass);
}

/** Unvaluable positions sort last whatever the order: they have no number to compare. */
export function sortHoldings(
  input: readonly DashboardHolding[],
  order: SortOrder,
): readonly DashboardHolding[] {
  const compare = (left: DashboardHolding, right: DashboardHolding): number => {
    if (left.valuation === null || right.valuation === null) {
      if (left.valuation === right.valuation) return left.symbol.localeCompare(right.symbol);
      return left.valuation === null ? 1 : -1;
    }

    switch (order) {
      case 'valueDesc':
        return right.valuation.value.amount.comparedTo(left.valuation.value.amount);

      case 'gainAbsoluteDesc': {
        const leftGain = left.valuation.gain;
        const rightGain = right.valuation.gain;
        if (leftGain === null || rightGain === null) {
          if (leftGain === rightGain) return left.symbol.localeCompare(right.symbol);
          return leftGain === null ? 1 : -1;
        }
        return rightGain.amount.comparedTo(leftGain.amount);
      }

      case 'gainPercentDesc': {
        const leftGain = left.valuation.gain;
        const rightGain = right.valuation.gain;
        const leftCost = left.cost;
        const rightCost = right.cost;
        if (leftGain === null || leftCost === null || rightGain === null || rightCost === null) {
          const leftOut = leftGain === null || leftCost === null;
          const rightOut = rightGain === null || rightCost === null;
          if (leftOut === rightOut) return left.symbol.localeCompare(right.symbol);
          return leftOut ? 1 : -1;
        }
        // Cross-multiply rather than compare ratios as numbers — same ordering,
        // no float conversion.
        const leftCross = leftGain.amount.times(rightCost.amount);
        const rightCross = rightGain.amount.times(leftCost.amount);
        return rightCross.comparedTo(leftCross);
      }

      case 'nameAsc':
        return left.symbol.localeCompare(right.symbol);
    }
  };

  return [...input].sort(compare);
}
