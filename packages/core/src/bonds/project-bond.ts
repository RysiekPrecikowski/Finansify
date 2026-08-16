import { type Money } from '../money';
import { Temporal } from '../time';
import { accrueBond } from './accrue-bond';
import { redemptionDateFor } from './series-code';
import {
  type BondAccrual,
  type BondPurchase,
  type BondTerms,
  type IndexObservation,
} from './types';

/**
 * Forward-looking bond figures — a cash-flow schedule, a redemption value at a
 * chosen date, and early-redemption value across a range.
 *
 * **Everything here is a projection and is typed as one.** `docs/roadmap.md` is
 * explicit that these are "labelled as projections and never with the certainty
 * of a current valuation", and the reason is concrete: every indexed family's
 * rate beyond the current period depends on a CPI print that does not exist
 * yet. A projection therefore has to say what it assumed, or the number is
 * indistinguishable from a valuation and will be read as one.
 */

/**
 * What an unknown future rate was assumed to be.
 *
 * There is deliberately no forecast and no extrapolation — rule 7 forbids
 * inventing a missing figure, and inventing *inflation* to value an
 * inflation-linked bond is the exact failure this project exists to avoid.
 * The only honest assumption is "the last published print continues", stated
 * plainly so the reader can discount it.
 */
export type ProjectionBasis =
  /** Every period's rate is known — the projection is arithmetic, not a guess. */
  | { readonly kind: 'actual' }
  /** Future periods reuse the newest observation. `from` is the date it was published. */
  | { readonly kind: 'last_known_index'; readonly from: Temporal.PlainDate };

export interface ProjectedCashFlow {
  /** 1-based, matching the published tables' "Okres odsetkowy". */
  readonly ordinal: number;
  readonly on: Temporal.PlainDate;
  readonly amount: Money;
  /** `interest` for a payout, `redemption` for the final return of nominal. */
  readonly kind: 'interest' | 'redemption';
  readonly basis: ProjectionBasis;
}

export interface BondProjection {
  readonly asOf: Temporal.PlainDate;
  readonly redeemsOn: Temporal.PlainDate;
  /** What the holder receives at maturity, gross. */
  readonly redemptionValue: Money;
  readonly basis: ProjectionBasis;
  readonly cashFlows: readonly ProjectedCashFlow[];
}

/**
 * What a projection reaching `through` had to assume.
 *
 * No observations are added and none are needed: `accrueBond` already takes the
 * latest observation *before* each period, so a period starting in 2030 reads
 * today's print without any help. That is exactly the assumption worth naming —
 * the engine is silently treating the newest known value as though it still
 * applied years out, which is correct arithmetic and a guess about the world.
 *
 * A fixed family has no index to be wrong about, so its projection is
 * arithmetic and says so.
 */
function basisFor(
  observations: readonly IndexObservation[],
  terms: BondTerms,
  through: Temporal.PlainDate,
): ProjectionBasis {
  const { indexId } = terms.rules;
  if (indexId === null) return { kind: 'actual' };

  let newest: IndexObservation | undefined;
  for (const observation of observations) {
    if (observation.indexId !== indexId) continue;
    if (
      newest === undefined ||
      Temporal.PlainDate.compare(observation.effectiveFrom, newest.effectiveFrom) > 0
    ) {
      newest = observation;
    }
  }
  if (newest === undefined) return { kind: 'actual' };

  return Temporal.PlainDate.compare(newest.effectiveFrom, through) >= 0
    ? { kind: 'actual' }
    : { kind: 'last_known_index', from: newest.effectiveFrom };
}

/**
 * Value a holding at a future date.
 *
 * Runs the same `accrueBond` the current valuation does, at a later `asOf` —
 * the projection is not a second engine, which is what keeps the two from
 * disagreeing.
 */
export function projectBondValue(
  terms: BondTerms,
  purchase: BondPurchase,
  on: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): { readonly accrual: BondAccrual; readonly basis: ProjectionBasis } {
  return {
    accrual: accrueBond(terms, purchase, on, observations),
    basis: basisFor(observations, terms, on),
  };
}

/**
 * The full schedule: every interest payment a holding will make, and the
 * redemption at the end.
 *
 * Capitalizing families produce exactly one flow — everything arrives at
 * redemption — which is not a bug in the schedule but the defining property of
 * TOS, ROS, EDO and ROD.
 */
export function projectBondCashFlows(
  terms: BondTerms,
  purchase: BondPurchase,
  asOf: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): BondProjection {
  const { rules } = terms;
  const redeemsOn = redemptionDateFor(purchase.settledOn, rules.tenorMonths);
  const basis = basisFor(observations, terms, redeemsOn);

  const cashFlows: ProjectedCashFlow[] = [];
  const periodCount = Math.round(rules.tenorMonths / rules.periodMonths);

  if (rules.payout !== 'at_redemption') {
    // Each period's interest is the difference between the accrual at its end
    // and at its start, which reuses the engine rather than re-deriving a
    // period rate here and risking a second, subtly different day count.
    for (let ordinal = 1; ordinal <= periodCount; ordinal += 1) {
      const endsOn = purchase.settledOn.add({ months: ordinal * rules.periodMonths });
      const accrual = accrueBond(terms, purchase, endsOn, observations);
      const period = accrual.periods.at(-1);
      if (period === undefined) continue;

      cashFlows.push({
        ordinal,
        on: endsOn,
        amount: period.interest,
        kind: 'interest',
        basis,
      });
    }
  }

  const atMaturity = accrueBond(terms, purchase, redeemsOn, observations);

  // **Nominal alone for a paying family.** Its final period has already been
  // emitted as its own `interest` flow on this very date, and at
  // `asOf = redeemsOn` that period is still *accrued* rather than paid — by
  // design in `accrueBond`, payment happens strictly past the end date — so it
  // sits inside `accruedInterest` too. Adding both put the same money on the
  // same date twice: COI0830 summed to 122.75 where 118.25 is due.
  //
  // Dropping the last interest flow instead would net out to the same total but
  // is not the same schedule: a consumer computing XIRR sees one cash amount
  // under a different label. Keeping all N interest flows and returning only
  // the nominal here is the shape that matches how the money actually arrives.
  const redemptionAmount =
    rules.payout === 'at_redemption'
      ? atMaturity.nominal.plus(atMaturity.accruedInterest)
      : atMaturity.nominal;

  cashFlows.push({
    ordinal: periodCount,
    on: redeemsOn,
    amount: redemptionAmount,
    kind: 'redemption',
    basis,
  });

  return {
    asOf,
    redeemsOn,
    // The summary field stays "what the holder is owed at maturity", which for
    // a payer is nominal plus that last unpaid period — correct on its own, and
    // exactly why the double count hid here.
    redemptionValue: atMaturity.nominal.plus(atMaturity.accruedInterest),
    basis,
    cashFlows,
  };
}

/**
 * What redeeming early would pay, day by day across a range.
 *
 * Answers the question the early-redemption fee actually raises — "is it worth
 * breaking this yet?" — which a single figure for today cannot.
 */
export function projectEarlyRedemption(
  terms: BondTerms,
  purchase: BondPurchase,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): readonly { readonly on: Temporal.PlainDate; readonly value: Money }[] {
  if (Temporal.PlainDate.compare(from, to) > 0) return [];

  const redeemsOn = redemptionDateFor(purchase.settledOn, terms.rules.tenorMonths);
  const last = Temporal.PlainDate.compare(to, redeemsOn) > 0 ? redeemsOn : to;

  const points: { on: Temporal.PlainDate; value: Money }[] = [];
  for (let on = from; Temporal.PlainDate.compare(on, last) <= 0; on = on.add({ days: 1 })) {
    points.push({
      on,
      value: accrueBond(terms, purchase, on, observations).earlyRedemptionValue,
    });
  }
  return points;
}
