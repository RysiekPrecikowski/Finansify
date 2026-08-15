import type Decimal from 'decimal.js';

import { type Lot } from '../positions/lot';
import { currency as toCurrency, Money } from '../money';
import { type Temporal } from '../time';
import { accrueBond } from './accrue-bond';
import { type BondAccrual, type BondTerms, type IndexObservation } from './types';

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
 */
export function valueBondPosition(
  terms: BondTerms,
  lots: readonly Lot[],
  asOf: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): ValuedBondPosition {
  const accruals: BondAccrual[] = [];

  let marketValue = Money.zero(PLN);
  let accruedInterest = Money.zero(PLN);
  let paidInterest = Money.zero(PLN);
  let earlyRedemptionValue = Money.zero(PLN);

  for (const lot of lots) {
    // A fully consumed lot contributes nothing and must not be accrued — its
    // quantity is zero, so it would add a zero row and nothing else, but
    // skipping keeps `lots` meaning "what you still hold".
    if (!lot.remainingQuantity.greaterThan(0)) continue;

    const accrual = accrueBond(
      terms,
      {
        seriesCode: terms.seriesCode,
        settledOn: lot.openedOn,
        // Retail bonds are indivisible: a lot is always a whole number of
        // them. `toNumber` is safe here for that reason and only that reason —
        // it is a count, never money (rule 1).
        quantity: wholeBondsIn(lot.remainingQuantity),
      },
      asOf,
      observations,
    );

    accruals.push(accrual);
    marketValue = marketValue.plus(accrual.currentValue);
    accruedInterest = accruedInterest.plus(accrual.accruedInterest);
    paidInterest = paidInterest.plus(accrual.paidInterest);
    earlyRedemptionValue = earlyRedemptionValue.plus(accrual.earlyRedemptionValue);
  }

  return { marketValue, accruedInterest, paidInterest, earlyRedemptionValue, lots: accruals };
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
