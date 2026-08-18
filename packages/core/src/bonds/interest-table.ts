import type Decimal from 'decimal.js';

import { type Money } from '../money';
import { type Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';
import { type BondSeriesCode } from './types';

/**
 * The published side of a bond's interest: the Ministry's own daily table, as
 * an emission agent serves it, read rather than recomputed.
 *
 * Pekao publishes one table per *purchase day*, but only for days 1, 29, 30 and
 * 31. That is not a gap in the data. A purchase on any day from the 2nd to the
 * 28th runs to the same day of the next month, so its period has exactly the
 * same length as one bought on the 1st and — because a daily value is a
 * function of (rate, period length, days elapsed) and never of the calendar —
 * exactly the same values. Only the month ends break that, because a month
 * without a 31st constrains the boundary and shortens the period.
 */
export type PurchaseDayKey = 1 | 29 | 30 | 31;

export interface BondInterestTable {
  readonly seriesCode: BondSeriesCode;
  /** 1-based, matching the published "Okres odsetkowy". */
  readonly periodOrdinal: number;
  readonly purchaseDayKey: PurchaseDayKey;
  /** Exactly as published — *not* normalized onto our period convention. */
  readonly startsOn: Temporal.PlainDate;
  readonly endsOn: Temporal.PlainDate;
  /** A fraction, not a percentage: 5,25% is `0.0525`. */
  readonly annualRate: Decimal;
  readonly source: ProviderName;
  /**
   * One value per calendar day from `startsOn` to `endsOn` inclusive, **per
   * bond** — the tables are published "dla 1 sztuki obligacji" and are already
   * rounded to the grosz, so nothing here is ever rounded again.
   */
  readonly dailyValues: readonly Money[];
}

/** Which published table a lot settled on this date must be read from. */
export function interestTableKeyFor(settledOn: Temporal.PlainDate): PurchaseDayKey {
  const { day } = settledOn;
  // A leap-shortened February has no 29th, 30th or 31st, so its 28th is an
  // ordinary mid-month purchase and falls through to the day-1 table.
  if (day === 29 || day === 30 || day === 31) return day;
  return 1;
}

/**
 * The value one bond carries on `asOf`, or `null` if this table cannot answer.
 *
 * `period` is *our* period in the engine's convention — `[startsOn, endsOn]`
 * with the boundary day belonging to the closing period — and the table is
 * indexed by days elapsed within it, never by calendar date. That is what lets
 * a lot settled on the 17th read the table published for the 1st.
 *
 * Two publishing conventions have to be told apart, and the span is what tells
 * them apart:
 *
 * - A **paying** family's table opens on the period's own first day, so its
 *   published span equals ours and the index is the elapsed day count.
 * - A **capitalizing** family's table opens the day *after*, because the
 *   previous period's table already prints the boundary day (EDO period 1
 *   closes 01.07 at 6,25 and period 2 opens 02.07 at 6,26). Its span is one
 *   shorter, the index is one less, and day zero is simply not in this table —
 *   returning its opening value there would report a day of interest that has
 *   not accrued.
 *
 * Any other span is refused. Reading February's 28-day table against a 31-day
 * period would silently under-report three days of interest; refusing sends the
 * caller to `accrueBond`, which is a correct answer rather than a cheaper wrong
 * one (rule 7).
 */
export function readInterestTable(
  table: BondInterestTable,
  period: { readonly startsOn: Temporal.PlainDate; readonly endsOn: Temporal.PlainDate },
  asOf: Temporal.PlainDate,
): Money | null {
  const ourSpan = period.startsOn.until(period.endsOn).days;
  const publishedSpan = table.startsOn.until(table.endsOn).days;

  const elapsed = period.startsOn.until(asOf).days;
  if (elapsed < 0 || elapsed > ourSpan) return null;

  let index: number;
  if (publishedSpan === ourSpan) {
    index = elapsed;
  } else if (publishedSpan === ourSpan - 1) {
    if (elapsed === 0) return null;
    index = elapsed - 1;
  } else {
    return null;
  }

  return table.dailyValues[index] ?? null;
}
