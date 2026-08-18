import Decimal from 'decimal.js';

import { currency, Money } from '../money';
import { Temporal } from '../time';
import { redemptionDateFor } from './series-code';
import {
  type BondAccrual,
  type BondInterestPeriod,
  type BondPurchase,
  type BondTerms,
  type EarlyRedemptionRule,
  type IndexId,
  type IndexObservation,
} from './types';

const PLN = currency('PLN');

/** Every retail treasury series is issued at 100 zł, in PLN, without exception. */
const NOMINAL_PER_BOND = Money.of('100', PLN);

const MONTHS_PER_YEAR = 12;

export class MissingIndexObservationError extends Error {
  constructor(indexId: IndexId, periodStartsOn: Temporal.PlainDate) {
    super(
      `No ${indexId} observation is effective before ${periodStartsOn.toString()}, so the rate for that interest period is unknown — it is never estimated or carried forward from the first period`,
    );
    this.name = 'MissingIndexObservationError';
  }
}

/**
 * The index value that governs a period.
 *
 * The two series need different cut-offs, and collapsing them into one
 * comparison is a valuation defect rather than a simplification:
 *
 * - **NBP reference rate** — an exact-date rule. The rate in force the day
 *   before the period opens is the rate that governs it, and `effectiveFrom`
 *   is the real `obowiazuje_od`, so `< startsOn` is literally correct.
 * - **PL CPI** — a *month* rule. The terms say "the print announced in the
 *   month preceding the period's first month", and the adapter dates an
 *   observation to the 1st of its announcement month (which is what GUS
 *   published, and worth keeping). Comparing that against an exact start date
 *   picks the print announced *during* the period's own first month for any
 *   bond not settled on the 1st — a figure that did not exist when the period
 *   opened. Same EDO, same prints, period 2: settled on the 1st gives 2.00%,
 *   settled on the 15th gives 9.00%. The rate must not depend on which day of
 *   the month someone happened to buy.
 *
 * So CPI compares against the first day of the period's start month, which is
 * the same thing the terms say in the units the terms use.
 */
function indexValueFor(
  indexId: IndexId,
  startsOn: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): Decimal {
  const cutOff =
    indexId === 'pl_cpi_yoy' ? startsOn.toPlainYearMonth().toPlainDate({ day: 1 }) : startsOn;

  let latest: IndexObservation | undefined;
  for (const observation of observations) {
    if (observation.indexId !== indexId) continue;
    if (Temporal.PlainDate.compare(observation.effectiveFrom, cutOff) >= 0) continue;
    if (
      latest === undefined ||
      Temporal.PlainDate.compare(observation.effectiveFrom, latest.effectiveFrom) > 0
    ) {
      latest = observation;
    }
  }
  if (latest === undefined) throw new MissingIndexObservationError(indexId, startsOn);

  // "W przypadku ujemnej stopy inflacji do ustalania oprocentowania brana jest
  // wartość zerowa" — the floor is a property of the CPI families' terms, so it
  // is applied to the print and not to the sum, leaving the margin intact. The
  // NBP reference rate carries no such clause and gets no floor.
  if (indexId === 'pl_cpi_yoy' && latest.value.isNegative()) return new Decimal(0);
  return latest.value;
}

function annualRateFor(
  terms: BondTerms,
  ordinal: number,
  startsOn: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): Decimal {
  const { indexId } = terms.rules;
  if (ordinal === 1 || indexId === null) return terms.firstPeriodRate;
  return indexValueFor(indexId, startsOn, observations).plus(terms.margin);
}

/**
 * Interest on **one** bond, rounded to the grosz.
 *
 * The day count is the period's own: a twelfth (or a quarter, or a whole) of the
 * annual rate, spread linearly across however many days that period happens to
 * contain. Neither ACT/365 nor ACT/366 reproduces the Ministry's published
 * table — see `__fixtures__/ror0827-period-1.ts` before changing this.
 *
 * Rounding happens here, per bond, because the tables are published "dla 1
 * sztuki obligacji" and that is the amount that lands in the account; rounding
 * the holding as a whole pays a different number.
 */
function interestPerBond(
  base: Money,
  annualRate: Decimal,
  periodMonths: number,
  elapsedDays: number,
  totalDays: number,
): { readonly exact: Money; readonly rounded: Money } {
  const periodRate = annualRate.times(periodMonths).dividedBy(MONTHS_PER_YEAR);
  const raw = base.amount.times(periodRate).times(elapsedDays).dividedBy(totalDays);
  return {
    exact: Money.of(raw, PLN),
    rounded: Money.of(raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), PLN),
  };
}

/**
 * What redeeming early actually pays out. Accrued interest only — interest
 * already paid to the holder is theirs and is not clawed back.
 */
export function earlyRedemptionValueOf(
  rule: EarlyRedemptionRule,
  nominal: Money,
  accruedInterest: Money,
  quantity: number,
  currentOrdinal: number,
): Money {
  if (rule.kind === 'forfeit_interest') return nominal;

  const fee = rule.amountPerBond.times(quantity);
  const capped = rule.capping === 'always' || currentOrdinal === 1;
  const charged = capped && fee.greaterThan(accruedInterest) ? accruedInterest : fee;
  return nominal.plus(accruedInterest).minus(charged);
}

/**
 * What one holding of a retail treasury bond is worth on `asOf`, gross of tax.
 *
 * Two conventions drive everything below and neither is obvious from the
 * Ministry's prose:
 *
 * 1. Every period boundary is `settledOn.add({ months: n × periodMonths })`,
 *    measured from the settlement anchor rather than stepped period by period.
 *    Stepping drifts on short months — 31 Aug + 1 month is 30 Sep, and 30 Sep +
 *    1 month is 30 Oct, a day early — while the anchor gives 31 Oct.
 * 2. A period's interest is *accrued* on its exact end date and only becomes
 *    paid (or capitalized) once `asOf` is strictly past it, which is how the
 *    published tables show it.
 */
export function accrueBond(
  terms: BondTerms,
  purchase: BondPurchase,
  asOf: Temporal.PlainDate,
  observations: readonly IndexObservation[],
): BondAccrual {
  const { rules } = terms;
  const { settledOn, quantity } = purchase;
  const nominal = NOMINAL_PER_BOND.times(quantity);

  // Nothing is owned before settlement — the money is still cash, and reporting
  // a nominal here would double-count it against the cash leg.
  if (Temporal.PlainDate.compare(asOf, settledOn) < 0) {
    return {
      seriesCode: terms.seriesCode,
      asOf,
      nominal: Money.zero(PLN),
      accruedInterest: Money.zero(PLN),
      paidInterest: Money.zero(PLN),
      currentValue: Money.zero(PLN),
      earlyRedemptionValue: Money.zero(PLN),
      periods: [],
      source: 'computed',
    };
  }

  // Accrual stops dead at redemption; a later `asOf` reports the redemption-day
  // figures rather than running the schedule on past the end of the bond.
  const redeemsOn = redemptionDateFor(settledOn, rules.tenorMonths);
  const upTo = Temporal.PlainDate.compare(asOf, redeemsOn) > 0 ? redeemsOn : asOf;

  const periods: BondInterestPeriod[] = [];
  let basePerBond = NOMINAL_PER_BOND;
  let capitalizedPerBond = Money.zero(PLN);
  let paidPerBond = Money.zero(PLN);
  let currentPerBond = Money.zero(PLN);
  let currentOrdinal = 1;

  for (let ordinal = 1; ; ordinal += 1) {
    const startsOn = settledOn.add({ months: (ordinal - 1) * rules.periodMonths });
    if (Temporal.PlainDate.compare(startsOn, redeemsOn) >= 0) break;
    if (Temporal.PlainDate.compare(startsOn, upTo) > 0) break;

    const endsOn = settledOn.add({ months: ordinal * rules.periodMonths });
    const totalDays = startsOn.until(endsOn).days;
    const elapsed = startsOn.until(upTo).days;
    const elapsedDays = elapsed > totalDays ? totalDays : elapsed;

    const annualRate = annualRateFor(terms, ordinal, startsOn, observations);
    const interest = interestPerBond(
      basePerBond,
      annualRate,
      rules.periodMonths,
      elapsedDays,
      totalDays,
    );

    periods.push({
      ordinal,
      startsOn,
      endsOn,
      annualRate,
      base: basePerBond.times(quantity),
      interest: interest.rounded.times(quantity),
    });

    if (Temporal.PlainDate.compare(upTo, endsOn) <= 0) {
      currentPerBond = interest.exact;
      currentOrdinal = ordinal;
      break;
    }

    if (rules.capitalizes) {
      // **Unrounded.** A capitalizing family carries its interest forward
      // rather than paying it, so there is no cash amount to round to a grosz
      // — the Ministry keeps the running balance exact and rounds only what it
      // reports. Capitalizing the rounded figure instead compounds the
      // rounding error, and the published TOS0727 table disagrees with it on
      // 166 of year three's 365 days, by a grosz each time. Years one and two
      // agree either way, which is why a single first-period table never
      // showed this.
      capitalizedPerBond = capitalizedPerBond.plus(interest.exact);
      basePerBond = basePerBond.plus(interest.exact);
    } else {
      // Paid out, so this one *is* a cash amount: the holder receives whole
      // grosze each period and the rounded figure is what leaves the account.
      paidPerBond = paidPerBond.plus(interest.rounded);
    }
  }

  // Capitalized interest is still the holder's and still unpaid, so it belongs
  // to accrued rather than to paid; that is also what keeps `currentValue` a
  // plain `nominal + accruedInterest` for every family.
  const accruedInterest = Money.of(
    capitalizedPerBond.plus(currentPerBond).amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    PLN,
  ).times(quantity);
  const paidInterest = paidPerBond.times(quantity);

  return {
    seriesCode: terms.seriesCode,
    asOf,
    nominal,
    accruedInterest,
    paidInterest,
    currentValue: nominal.plus(accruedInterest),
    earlyRedemptionValue: earlyRedemptionValueOf(
      rules.earlyRedemption,
      nominal,
      accruedInterest,
      quantity,
      currentOrdinal,
    ),
    periods,
    source: 'computed',
  };
}
