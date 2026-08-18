import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { Temporal } from '../time';
import { interestTableKeyFor, readInterestTable, type BondInterestTable } from './interest-table';
import { parseSeriesCode } from './series-code';
import published from './__fixtures__/pekao-tables.json';

/**
 * The published-table half of the bond valuation, specified before it exists
 * (rule 17). Every number here is Bank Pekao's, retrieved 2026-08-18 and frozen
 * in `__fixtures__/pekao-tables.json`; nothing in this file is computed by us.
 *
 * The one thing worth stating up front, because the whole module rests on it
 * and it was measured rather than assumed: **a published daily value is a
 * function of (rate, period length, days elapsed) and not of the calendar**.
 * `ROR0726/9-1` covers 01.03–01.04 and `ROR0726/8-31` covers 28.02–31.03, both
 * at 4,00% over 31 days, and the two tables are identical value for value. That
 * is what makes a table published for one purchase day readable for another —
 * the "offset" — and `offsetIsWhatMakesThisWork` below pins it to the data so a
 * future fixture refresh cannot quietly withdraw it.
 */

const PLN = currency('PLN');
const d = (iso: string) => Temporal.PlainDate.from(iso);

type Fixture = (typeof published)[number];

const fixture = (series: string, ordinal: number, dayKey: number): Fixture => {
  const found = published.find(
    (table) =>
      table.series === series && table.periodOrdinal === ordinal && table.purchaseDayKey === dayKey,
  );
  if (found === undefined) throw new Error(`No fixture for ${series} ${ordinal}-${dayKey}`);
  return found;
};

/**
 * `"5,25%"` → `0.0525`, without `parseFloat` (rule 1) and without peeling the
 * string apart character by character — the published format is matched whole,
 * so anything else fails loudly here rather than being tidied into a number.
 */
const PUBLISHED_PERCENT = /^(-?\d+)(?:,(\d+))?%?$/;

const asFraction = (percent: string) => {
  const match = PUBLISHED_PERCENT.exec(percent.trim());
  if (match === null) throw new Error(`"${percent}" is not a published percentage`);
  const [, whole = '', fraction] = match;
  return new Decimal(fraction === undefined ? whole : `${whole}.${fraction}`).dividedBy(100);
};

const tableFrom = (entry: Fixture): BondInterestTable => ({
  seriesCode: parseSeriesCode(entry.series).code,
  periodOrdinal: entry.periodOrdinal,
  purchaseDayKey: entry.purchaseDayKey as 1 | 29 | 30 | 31,
  startsOn: d(entry.startsOn),
  endsOn: d(entry.endsOn),
  annualRate: asFraction(entry.annualRatePercent),
  source: 'pekao',
  dailyValues: entry.dailyValues.map((value) => Money.of(value, PLN)),
});

const table = (series: string, ordinal: number, dayKey = 1) =>
  tableFrom(fixture(series, ordinal, dayKey));

/** Our own period, in the engine's half-open convention: `[startsOn, endsOn]`. */
const period = (startsOn: string, endsOn: string) => ({
  startsOn: d(startsOn),
  endsOn: d(endsOn),
});

describe('interestTableKeyFor', () => {
  /**
   * Pekao publishes one table per *purchase day*, but only for days 1, 29, 30
   * and 31 — not because the other days are missing, but because a purchase on
   * any day from the 2nd to the 28th produces a period of exactly the same
   * length as one bought on the 1st (both run to the same day of the next
   * month), and therefore exactly the same table. The month ends are the only
   * days where that stops being true.
   */
  it.each([1, 2, 7, 15, 17, 28])('sends a purchase on day %i to the day-1 table', (day) => {
    expect(interestTableKeyFor(d(`2026-03-${String(day).padStart(2, '0')}`))).toBe(1);
  });

  it.each([29, 30, 31])('keeps day %i on its own table', (day) => {
    expect(interestTableKeyFor(d(`2026-01-${day}`))).toBe(day);
  });

  it('sends 28 February to the day-1 table, not to the 28th', () => {
    // A leap-shortened month has no 29th, 30th or 31st, so the 28th is an
    // ordinary mid-month purchase there and Pekao publishes no `-28` key.
    expect(interestTableKeyFor(d('2026-02-28'))).toBe(1);
  });
});

describe('readInterestTable', () => {
  it('reads the value for the day the period opens', () => {
    const value = readInterestTable(
      table('ROR0726', 1),
      period('2025-07-01', '2025-08-01'),
      d('2025-07-01'),
    );
    expect(value?.equals(Money.of('0.00', PLN))).toBe(true);
  });

  it('reads a mid-period day by days elapsed', () => {
    // 17 July 2025 is the 17th cell of the published table: 0,23 per bond.
    const value = readInterestTable(
      table('ROR0726', 1),
      period('2025-07-01', '2025-08-01'),
      d('2025-07-17'),
    );
    expect(value?.equals(Money.of('0.23', PLN))).toBe(true);
  });

  it('reads the closing value on the period end date', () => {
    const value = readInterestTable(
      table('ROR0726', 1),
      period('2025-07-01', '2025-08-01'),
      d('2025-08-01'),
    );
    expect(value?.equals(Money.of('0.44', PLN))).toBe(true);
  });

  /**
   * The offset itself: a lot settled on the 17th reads the day-1 table, and the
   * value it gets is the one published for *its* seventeenth day, not for the
   * 17th of the calendar month.
   */
  it('reads a table published for another purchase day, by offset', () => {
    const value = readInterestTable(
      table('ROR0726', 9),
      period('2026-03-17', '2026-04-17'),
      d('2026-03-20'),
    );
    const threeDaysIn = Money.of(fixture('ROR0726', 9, 1).dailyValues[3]!, PLN);
    expect(value?.equals(threeDaysIn)).toBe(true);
  });

  it('refuses a day before the period opens', () => {
    expect(
      readInterestTable(table('ROR0726', 1), period('2025-07-01', '2025-08-01'), d('2025-06-30')),
    ).toBeNull();
  });

  it('refuses a day past the period end', () => {
    expect(
      readInterestTable(table('ROR0726', 1), period('2025-07-01', '2025-08-01'), d('2025-08-02')),
    ).toBeNull();
  });

  /**
   * The guard that turns the offset from an assumption into a checked
   * condition. February's table runs 28 days; a period that runs 31 is not the
   * same period, and reading one against the other would silently under-report
   * by three days of interest. Refusing sends the caller to `accrueBond`
   * instead, which is a correct answer rather than a cheaper wrong one
   * (rule 7).
   */
  it('refuses a table whose period is a different length', () => {
    expect(
      readInterestTable(table('ROR0726', 8), period('2026-03-01', '2026-04-01'), d('2026-03-10')),
    ).toBeNull();
  });

  describe('a capitalizing family, whose table is published one day later', () => {
    /**
     * EDO's tables accumulate since issue rather than resetting each year, and
     * the Ministry does not repeat the boundary day: period 1 closes on
     * 01.07.2026 at 6,25 and period 2 *opens on 02.07.2026* at 6,26. So a
     * capitalizing period's published span is one day shorter than the period
     * itself, and day zero of the period is only readable from the previous
     * table. Both facts are Pekao's, not ours.
     */
    const ourPeriodTwo = period('2026-07-01', '2027-07-01');

    it('accepts the one-day-shorter table and reads the first published day', () => {
      const value = readInterestTable(table('EDO0735', 2), ourPeriodTwo, d('2026-07-02'));
      expect(value?.equals(Money.of('6.26', PLN))).toBe(true);
    });

    it('reads a mid-period day', () => {
      // 01.08.2026 — 6,25 capitalized from year one plus a month of year two.
      const value = readInterestTable(table('EDO0735', 2), ourPeriodTwo, d('2026-08-01'));
      expect(value?.equals(Money.of('6.71', PLN))).toBe(true);
    });

    it('refuses the boundary day, which this table does not publish', () => {
      // 01.07.2026 belongs to period 1's table (at 6,25). Returning period 2's
      // opening value here would report a day of interest that has not accrued.
      expect(readInterestTable(table('EDO0735', 2), ourPeriodTwo, d('2026-07-01'))).toBeNull();
    });

    it('reads the closing value on the period end date', () => {
      const value = readInterestTable(table('EDO0735', 2), ourPeriodTwo, d('2027-07-01'));
      expect(value?.equals(Money.of('11.67', PLN))).toBe(true);
    });
  });
});

describe('the published data these tests rest on', () => {
  /**
   * Not a test of our code. It pins the two properties of Pekao's tables that
   * the module is built on, so that refreshing the fixtures from the API can
   * never quietly remove them.
   */
  it('publishes exactly one value per calendar day of the period', () => {
    for (const entry of published) {
      const span = d(entry.startsOn).until(d(entry.endsOn)).days;
      expect(entry.dailyValues).toHaveLength(span + 1);
    }
  });

  it('offsetIsWhatMakesThisWork: same rate and length, same values, different calendar', () => {
    const midMonth = fixture('ROR0726', 9, 1); // 01.03–01.04, 4,00%, 31 days
    const monthEnd = fixture('ROR0726', 8, 31); // 28.02–31.03, 4,00%, 31 days
    expect(monthEnd.startsOn).not.toEqual(midMonth.startsOn);
    expect(monthEnd.dailyValues).toEqual(midMonth.dailyValues);
  });
});
