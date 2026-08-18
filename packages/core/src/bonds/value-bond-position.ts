import type Decimal from 'decimal.js';

import { type Lot } from '../positions/lot';
import { currency as toCurrency, Money } from '../money';
import { type Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';
import { accrueBond } from './accrue-bond';
import { interestTableKeyFor, type BondInterestTable, type PurchaseDayKey } from './interest-table';
import {
  type BondAccrual,
  type BondPurchase,
  type BondTerms,
  type IndexObservation,
} from './types';
import { valueBondFromTables } from './value-from-tables';

const PLN = toCurrency('PLN');

/**
 * A bond holding, valued.
 *
 * Deliberately shaped like a priced position's result rather than like a
 * `BondAccrual`: `/portfolio` puts bonds in the same table as equities, and a
 * second shape there would mean a second column set and a second set of
 * totals. What differs is *how* the number is obtained, not what it is.
 */
export interface ValuedBondPosition {
  readonly marketValue: Money;
  readonly accruedInterest: Money;
  readonly paidInterest: Money;
  readonly earlyRedemptionValue: Money;
  /**
   * Where the position's figures came from, and deliberately pessimistic: one
   * lot that fell back to the engine makes the whole position `'computed'`.
   * The alternative — naming the agent because most lots came from it — would
   * put an official-looking label on a total that is partly ours, which is the
   * one thing this field exists to prevent.
   */
  readonly source: ProviderName | 'computed';
  /** One accrual per open lot, because each lot has its own purchase date. */
  readonly lots: readonly BondAccrual[];
}

/**
 * Value every open lot of one bond series and sum them.
 *
 * **Per lot, not per position**, and that is the whole reason this function
 * exists. A bond's interest periods run from *its own settlement date* — the
 * Ministry publishes one interest table per purchase date — so a holding built
 * from three purchases in three different months is three different accrual
 * schedules that happen to share a series code. Summing quantities first and
 * accruing once would use one date for all of them and quietly misprice two
 * thirds of the position.
 *
 * `remainingQuantity` rather than `originalQuantity`: a partially redeemed lot
 * accrues on what is left.
 *
 * Each lot carries **its own** terms, because `resolveFamilyRules` is
 * effective-dated by purchase date: the early-redemption fee moved on
 * 2024-09-01, so two lots of the same series bought either side of it really do
 * face different fees. One shared `BondTerms` would quietly apply the earliest
 * lot's fee to all of them.
 */
/** One open lot with the terms in force for *its* purchase date. */
export interface LotWithTerms {
  readonly lot: Lot;
  readonly terms: BondTerms;
}

/**
 * The published tables on hand for one purchase day, keyed by period ordinal.
 * A lot settled on the 17th and one settled on the 31st read different tables,
 * so the lookup is by day key rather than by series.
 */
export type PublishedTables = (
  purchaseDayKey: PurchaseDayKey,
) => ReadonlyMap<number, BondInterestTable>;

const nothingPublished: PublishedTables = () => new Map();

export function valueBondPosition(
  holdings: readonly LotWithTerms[],
  asOf: Temporal.PlainDate,
  observations: readonly IndexObservation[],
  published: PublishedTables = nothingPublished,
): ValuedBondPosition {
  const accruals: BondAccrual[] = [];

  let marketValue = Money.zero(PLN);
  let accruedInterest = Money.zero(PLN);
  let paidInterest = Money.zero(PLN);
  let earlyRedemptionValue = Money.zero(PLN);

  for (const { lot, terms } of holdings) {
    // A fully consumed lot contributes nothing and must not be accrued — its
    // quantity is zero, so it would add a zero row and nothing else, but
    // skipping keeps `lots` meaning "what you still hold".
    if (!lot.remainingQuantity.greaterThan(0)) continue;

    const purchase: BondPurchase = {
      seriesCode: terms.seriesCode,
      settledOn: lot.openedOn,
      // Retail bonds are indivisible: a lot is always a whole number of
      // them. `toNumber` is safe here for that reason and only that reason —
      // it is a count, never money (rule 1).
      quantity: wholeBondsIn(lot.remainingQuantity),
    };

    // The Ministry's own figure first, our reproduction of it second. The order
    // matters beyond precedence: a series valued from published tables needs no
    // index history, no margin and no day-count rule to be right, so it cannot
    // drift from what the holder is actually paid. `valueBondFromTables`
    // returns `null` the moment a table it needs is missing or does not line
    // up, and the engine — golden-tested against these same tables — answers
    // instead. Neither path ever estimates (rule 7).
    const accrual =
      valueBondFromTables(terms, purchase, asOf, published(interestTableKeyFor(lot.openedOn))) ??
      accrueBond(terms, purchase, asOf, observations);

    accruals.push(accrual);
    marketValue = marketValue.plus(accrual.currentValue);
    accruedInterest = accruedInterest.plus(accrual.accruedInterest);
    paidInterest = paidInterest.plus(accrual.paidInterest);
    earlyRedemptionValue = earlyRedemptionValue.plus(accrual.earlyRedemptionValue);
  }

  return {
    marketValue,
    accruedInterest,
    paidInterest,
    earlyRedemptionValue,
    source: sharedSourceOf(accruals),
    lots: accruals,
  };
}

/**
 * The one source every lot agrees on, or `'computed'`. A position with no open
 * lots has nothing published behind it either, so it is `'computed'` too.
 */
function sharedSourceOf(accruals: readonly BondAccrual[]): ProviderName | 'computed' {
  const first = accruals[0]?.source;
  if (first === undefined || first === 'computed') return 'computed';
  return accruals.every((accrual) => accrual.source === first) ? first : 'computed';
}

export class FractionalBondError extends Error {
  constructor(quantity: Decimal) {
    super(
      `A bond holding of ${quantity.toFixed()} is not whole — retail treasury bonds are indivisible, so this lot cannot be valued`,
    );
    this.name = 'FractionalBondError';
  }
}

/**
 * Refuses a fractional holding rather than rounding one. Nothing in the ledger
 * stops a user typing 2.5 into the quantity field, and silently flooring it
 * would under-report their position for as long as they held it.
 */
function wholeBondsIn(quantity: Decimal): number {
  if (!quantity.isInteger()) throw new FractionalBondError(quantity);
  return quantity.toNumber();
}
