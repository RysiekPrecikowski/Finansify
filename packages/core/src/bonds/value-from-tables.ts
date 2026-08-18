import { currency, Money } from '../money';
import { Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';
import { earlyRedemptionValueOf } from './accrue-bond';
import { readInterestTable, type BondInterestTable } from './interest-table';
import { redemptionDateFor } from './series-code';
import {
  type BondAccrual,
  type BondInterestPeriod,
  type BondPurchase,
  type BondTerms,
} from './types';

const PLN = currency('PLN');

const NOMINAL_PER_BOND = Money.of('100', PLN);

/**
 * What a holding is worth on `asOf`, taken from the **published** tables rather
 * than from our own arithmetic — same shape as `accrueBond`, same conventions,
 * different provenance.
 *
 * Period boundaries are built exactly as the engine builds them
 * (`settledOn.add({ months: n × periodMonths })`, anchored on settlement rather
 * than stepped), because a holding's periods are a property of the holding and
 * not of whichever table happens to be on hand.
 *
 * `null` the moment a table it needs is absent or does not line up, so the
 * caller falls back to the engine rather than to a guess (rule 7). A missing
 * closed period is not "zero interest that month" — it is an unknown, and
 * summing around it would under-report `paidInterest` with no sign that
 * anything was skipped.
 *
 * The two families divide on what the table means, which was measured on
 * Pekao's API rather than assumed:
 *
 * - **Paying** — the table restarts at 0,00 each period. Closed periods have
 *   left the account and are `paidInterest`; the base is always 100 zł.
 * - **Capitalizing** — the table accumulates since issue, so today's value
 *   already contains every earlier period. Adding closed periods on top of it
 *   counts them twice; nothing is ever paid out, and period n accrues on 100 zł
 *   plus period n−1's published close.
 *
 * Published values are per bond and already rounded to the grosz, so they are
 * never rounded again here — only multiplied by quantity on the way out, which
 * is what `accrueBond` does and what actually lands in the account.
 */
export function valueBondFromTables(
  terms: BondTerms,
  purchase: BondPurchase,
  asOf: Temporal.PlainDate,
  tables: ReadonlyMap<number, BondInterestTable>,
): BondAccrual | null {
  const { rules } = terms;
  const { settledOn, quantity } = purchase;

  // Before settlement there is nothing published to read, and nothing owned.
  if (Temporal.PlainDate.compare(asOf, settledOn) < 0) return null;

  const redeemsOn = redemptionDateFor(settledOn, rules.tenorMonths);
  const upTo = Temporal.PlainDate.compare(asOf, redeemsOn) > 0 ? redeemsOn : asOf;

  const periods: BondInterestPeriod[] = [];
  let paidPerBond = Money.zero(PLN);
  /** Period n−1's published close, per bond. Zero before the first period. */
  let previousClosePerBond = Money.zero(PLN);
  let currentPerBond: Money | null = null;
  let currentOrdinal = 1;
  let source: ProviderName | null = null;

  for (let ordinal = 1; ; ordinal += 1) {
    const startsOn = settledOn.add({ months: (ordinal - 1) * rules.periodMonths });
    if (Temporal.PlainDate.compare(startsOn, redeemsOn) >= 0) break;
    if (Temporal.PlainDate.compare(startsOn, upTo) > 0) break;

    const endsOn = settledOn.add({ months: ordinal * rules.periodMonths });
    const table = tables.get(ordinal);
    if (table === undefined) return null;

    // A period is still current on its own end date — interest is accrued there
    // and only becomes paid (or capitalized) once `asOf` is strictly past it,
    // which is the convention the published tables show by printing the closing
    // figure on that date.
    const isCurrent = Temporal.PlainDate.compare(upTo, endsOn) <= 0;
    const value = readInterestTable(table, { startsOn, endsOn }, isCurrent ? upTo : endsOn);
    if (value === null) return null;

    const basePerBond = rules.capitalizes
      ? NOMINAL_PER_BOND.plus(previousClosePerBond)
      : NOMINAL_PER_BOND;
    // A cumulative table's period interest is the step it took, not its value.
    const interestPerBond = rules.capitalizes ? value.minus(previousClosePerBond) : value;

    periods.push({
      ordinal,
      startsOn,
      endsOn,
      // The rate the agent published for this period, not one we derived from
      // an index observation — that is the whole point of reading the table.
      annualRate: table.annualRate,
      base: basePerBond.times(quantity),
      interest: interestPerBond.times(quantity),
    });

    if (isCurrent) {
      currentPerBond = value;
      currentOrdinal = ordinal;
      source = table.source;
      break;
    }

    if (!rules.capitalizes) paidPerBond = paidPerBond.plus(value);
    previousClosePerBond = value;
  }

  if (currentPerBond === null || source === null) return null;

  const nominal = NOMINAL_PER_BOND.times(quantity);
  // Cumulative for a capitalizing family, this period alone for a paying one —
  // in both cases exactly what the current table prints, with no earlier period
  // added back.
  const accruedInterest = currentPerBond.times(quantity);
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
    source,
  };
}
