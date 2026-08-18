import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Temporal, currency, Money, type BondInterestTableKey } from '@finansify/core';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  UnreadableInterestTableError,
  parseInterestTable,
  parsePublishedTables,
} from './interest-table-provider';

/**
 * The fixtures are the real payloads, retrieved from Pekao's own endpoints on
 * 2026-08-18 and frozen. Nothing here touches the network: what is under test
 * is the reading of the Ministry's tables, and a test that had to reach the
 * agent to run would stop pinning that the day the agent changes shape.
 */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '__fixtures__', `${name}.json`), 'utf-8');

const PLN = currency('PLN');
const pln = (amount: string) => Money.of(amount, PLN);
const date = (iso: string) => Temporal.PlainDate.from(iso);
const key = (periodOrdinal: number, purchaseDayKey: 1 | 29 | 30 | 31): BondInterestTableKey => ({
  periodOrdinal,
  purchaseDayKey,
});

/** Mutating a real payload, so a refusal case cannot drift from the real shape. */
type Grid = {
  interestFrom: string;
  interestTo: string;
  interestRatePercentage: string;
  tables: { name: string; header: { items: string[] }; rows: { items: string[] }[] }[];
};
const asGrid = (name: string) => JSON.parse(fixture(name)) as Grid;
const cell = (grid: Grid, table: number, row: number, column: number, value: string) => {
  grid.tables[table]!.rows[row]!.items[column] = value;
  return JSON.stringify(grid);
};

describe('parseInterestTable — a paying family', () => {
  const table = parseInterestTable(fixture('ror0726-1-1'), key(1, 1));

  it('reads the series, the period and the day the table was published for', () => {
    expect(table.seriesCode).toBe('ROR0726');
    expect(table.periodOrdinal).toBe(1);
    expect(table.purchaseDayKey).toBe(1);
    expect(table.source).toBe('pekao');
  });

  it('dates the period from the header rather than from the grid', () => {
    expect(table.startsOn.toString()).toBe('2025-07-01');
    expect(table.endsOn.toString()).toBe('2025-08-01');
  });

  it('carries the rate as a fraction, the way the domain works in', () => {
    // Published as "5,25%". A table that handed 5.25 on would re-rate every
    // holding of the series by a factor of a hundred.
    expect(table.annualRate.toFixed(4)).toBe('0.0525');
  });

  it('yields one value per calendar day of the period, inclusive of both ends', () => {
    // 01.07 through 01.08 is 32 days, not 31: the boundary day belongs to the
    // closing period and the table prints it.
    expect(table.dailyValues).toHaveLength(table.startsOn.until(table.endsOn).days + 1);
    expect(table.dailyValues[0]).toEqual(pln('0.00'));
    expect(table.dailyValues.at(-1)).toEqual(pln('0.44'));
  });

  it('reads the grid month by month, not row by row', () => {
    // Row one of the grid carries both 01.07 (0,00) and 01.08 (0,44); a
    // row-major read would put the closing figure second in the series.
    expect(table.dailyValues[1]).toEqual(pln('0.01'));
    expect(table.dailyValues[30]).toEqual(pln('0.42'));
  });

  it('never rounds a published grosz through a float', () => {
    // The tables are already rounded "dla 1 sztuki obligacji"; anything that
    // went through `parseFloat` would come back as 0.44000000000000001 and
    // stop comparing equal to the figure the holder is paid.
    expect(table.dailyValues.at(-1)?.amount.equals(new Decimal('0.44'))).toBe(true);
    expect(table.dailyValues.at(-1)?.amount.toFixed(2)).toBe('0.44');
  });
});

describe('parseInterestTable — a period spanning two calendar years', () => {
  const table = parseInterestTable(fixture('edo0735-1-1'), key(1, 1));

  it('flattens the two grids into one contiguous run of days', () => {
    expect(table.startsOn.toString()).toBe('2025-07-01');
    expect(table.endsOn.toString()).toBe('2026-07-01');
    expect(table.dailyValues).toHaveLength(366);
  });

  it('orders the run by calendar date, not by the grid it came from', () => {
    // The case a naive read gets wrong: the 2026 grid is a second table, so
    // concatenating them would still be right, but reading either grid
    // row-major would interleave January with July.
    expect(table.dailyValues[0]).toEqual(pln('0.00'));
    // 01.01.2026 is the 185th day of the period, and prints 3,15.
    const offset = table.startsOn.until(date('2026-01-01')).days;
    expect(table.dailyValues[offset]).toEqual(pln('3.15'));
    expect(table.dailyValues.at(-1)).toEqual(pln('6.25'));
  });

  it('never lets the run fall backwards', () => {
    const values = table.dailyValues;
    expect(values.every((value, i) => i === 0 || !value.lessThan(values[i - 1]!))).toBe(true);
  });
});

describe('parseInterestTable — the capitalizing convention', () => {
  const table = parseInterestTable(fixture('edo0735-2-1'), key(2, 1));

  it('opens the day after the previous period closed', () => {
    // EDO period 1 closes 01.07.2026 printing 6,25; period 2 opens 02.07.2026
    // printing 6,26 — the previous period's closing day is not repeated. A
    // reader that assumed period 2 opened on 01.07 at 0,00 would lose a year.
    expect(table.startsOn.toString()).toBe('2026-07-02');
    expect(table.dailyValues[0]).toEqual(pln('6.26'));
  });

  it('accumulates since issue rather than restarting at zero', () => {
    expect(table.annualRate.toFixed(4)).toBe('0.0510');
    expect(table.dailyValues.at(-1)).toEqual(pln('11.67'));
  });
});

describe('parseInterestTable — the other families', () => {
  it.each([
    ['tos0729-1-1', 'TOS0729', '0.0440', 366, '4.40'],
    ['coi0730-1-1', 'COI0730', '0.0475', 366, '4.75'],
    ['dor0728-1-1', 'DOR0728', '0.0415', 32, '0.35'],
  ])('reads %s', (name, code, rate, length, last) => {
    const table = parseInterestTable(fixture(name), key(1, 1));
    expect(table.seriesCode).toBe(code);
    expect(table.annualRate.toFixed(4)).toBe(rate);
    expect(table.dailyValues).toHaveLength(length);
    expect(table.dailyValues[0]).toEqual(pln('0.00'));
    expect(table.dailyValues.at(-1)).toEqual(pln(last));
  });

  it('reads a month-end table on its own dates, not the day-1 ones', () => {
    // A lot settled on the 31st runs 28.02 → 31.03; reading the day-1 table
    // for it would silently shift the whole period.
    const table = parseInterestTable(fixture('ror0726-8-31'), key(8, 31));
    expect(table.purchaseDayKey).toBe(31);
    expect(table.startsOn.toString()).toBe('2026-02-28');
    expect(table.endsOn.toString()).toBe('2026-03-31');
    expect(table.dailyValues[0]).toEqual(pln('0.00'));
  });

  it('refuses a payload that is not the period it was asked for', () => {
    // The payload names its own period and purchase day, and those are the only
    // two fields that can tell a mispaired fetch from a correct one. Filing it
    // under the requested key regardless would give a holding of the day-1
    // table the month-end dates and values, in silence — and the span check
    // downstream only catches the mispairings whose spans happen to differ.
    try {
      parseInterestTable(fixture('ror0726-8-31'), key(1, 1));
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(UnreadableInterestTableError);
      // Both halves have to be in the message: what was asked for, and what
      // came back. Either one alone leaves the reader guessing which is wrong.
      expect((error as Error).message).toContain('1-1');
      expect((error as Error).message).toContain('period 8-31');
    }
  });
});

describe('parseInterestTable — when it must refuse', () => {
  const message = (payload: string, requested: BondInterestTableKey) => {
    try {
      parseInterestTable(payload, requested);
      return expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(UnreadableInterestTableError);
      return (error as Error).message;
    }
  };

  it('refuses a grid with a hole in it rather than shifting every later day', () => {
    // Blank 03.07 and hand 02.08 a value instead: the count still matches, so
    // only the day-by-day walk catches it. Shifting the run by one day would
    // misprice the holding by a day of interest for the rest of the period.
    const grid = asGrid('ror0726-1-1');
    grid.tables[0]!.rows[2]!.items[1] = '';
    const payload = cell(grid, 0, 1, 2, '0,45');

    expect(message(payload, key(1, 1))).toContain('2025-07-03');
  });

  it('refuses a value that falls, because accrued interest cannot', () => {
    const payload = cell(asGrid('ror0726-1-1'), 0, 9, 1, '0,05');
    expect(message(payload, key(1, 1))).toContain('falls');
  });

  it('refuses a rate outside the band any retail series has ever paid', () => {
    const grid = asGrid('ror0726-1-1');
    grid.interestRatePercentage = '30,00%';
    expect(message(JSON.stringify(grid), key(1, 1))).toContain('0–25%');
  });

  it('refuses a cell it cannot read as a number rather than treating it as zero', () => {
    const payload = cell(asGrid('ror0726-1-1'), 0, 4, 1, 'b.d.');
    expect(message(payload, key(1, 1))).toContain('b.d.');
  });

  it('refuses a grid whose day count disagrees with the published dates', () => {
    // The header says the period is a week shorter than the grid describes.
    // One of the two is wrong and this adapter cannot tell which.
    const grid = asGrid('ror0726-1-1');
    grid.interestTo = '25.07.2025';
    expect(message(JSON.stringify(grid), key(1, 1))).toContain('dated values');
  });

  it('names the series and the key in every refusal', () => {
    // A refusal nobody can act on is barely better than a wrong number: the
    // message is what tells the next reader which table to go and look at.
    const grid = asGrid('ror0726-8-31');
    grid.interestRatePercentage = '99,00%';
    const text = message(JSON.stringify(grid), key(8, 31));
    expect(text).toContain('ROR0726');
    expect(text).toContain('8-31');
  });

  it('refuses a payload carrying no period dates at all', () => {
    const grid = asGrid('ror0726-1-1') as Partial<Grid>;
    delete grid.interestFrom;
    expect(message(JSON.stringify(grid), key(1, 1))).toContain('no interest period dates');
  });

  it('refuses a grid dated against something that is not a year', () => {
    const grid = asGrid('ror0726-1-1');
    grid.tables[0]!.name = 'Razem';
    expect(message(JSON.stringify(grid), key(1, 1))).toContain('Razem');
  });
});

describe('parsePublishedTables', () => {
  it('returns every key the agent publishes for a series, ordered by period', () => {
    const keys = parsePublishedTables(fixture('ror0726-periods'));

    expect(keys).toHaveLength(26);
    const ordinals = keys.map((k) => k.periodOrdinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(keys[0]).toEqual({ periodOrdinal: 1, purchaseDayKey: 1 });
  });

  it('keeps the four month-end keys a series really publishes', () => {
    const eighth = parsePublishedTables(fixture('ror0726-periods'))
      .filter((k) => k.periodOrdinal === 8)
      .map((k) => k.purchaseDayKey);

    expect([...eighth].sort((a, b) => a - b)).toEqual([1, 29, 30, 31]);
  });

  it('drops a purchase day this adapter does not model instead of guessing at it', () => {
    // A key for the 15th would describe a period shape nothing here knows how
    // to read; skipping it is safe, because a table never asked for simply
    // sends the caller to the engine.
    const listing = JSON.parse(fixture('ror0726-periods')) as Record<string, string>;
    listing['5-15'] = '15.11.2025 - 15.12.2025';
    listing['5-2'] = '02.11.2025 - 02.12.2025';

    const days = parsePublishedTables(JSON.stringify(listing)).map((k) => k.purchaseDayKey);
    expect(days).not.toContain(15);
    expect(days).not.toContain(2);
  });

  it('reads the annual families too, where a period is a year', () => {
    expect(parsePublishedTables(fixture('edo0735-periods'))).toEqual([
      { periodOrdinal: 1, purchaseDayKey: 1 },
      { periodOrdinal: 2, purchaseDayKey: 1 },
    ]);
    expect(parsePublishedTables(fixture('coi0730-periods'))).toEqual([
      { periodOrdinal: 1, purchaseDayKey: 1 },
    ]);
  });

  it('answers a series that publishes nothing with no keys, not an error', () => {
    // ROS publishes no tables at all. That is a boundary of the source, and
    // the caller's answer to it is the engine, not a failed refresh.
    expect(parsePublishedTables(fixture('ros-series'))).toEqual([]);
    expect(parsePublishedTables('{}')).toEqual([]);
  });

  it('ignores anything in the listing that is not a period key', () => {
    // The family endpoint answers with a list of series codes; pointed at this
    // parser it must yield nothing rather than a period numbered zero.
    expect(parsePublishedTables(fixture('ror-series'))).toEqual([]);
  });
});

/**
 * A capitalizing family's table accumulates since issue, so its last periods
 * print the whole holding's interest to date — and over ten or twelve years
 * that is routinely more than the 100 zł nominal, not a sign of a changed
 * payload. ROD runs twelve years on CPI + 2,50%; EDO ran a 17,9% year in 2023.
 * A band drawn snug against the nominal would refuse the first period to cross
 * it and drop every holder of the series onto the engine, silently.
 */
describe('a late period of a capitalizing family', () => {
  /** The real second-year grid with a decade of capitalized interest under it. */
  const shiftedBy = (amount: string) => {
    const grid = asGrid('edo0735-2-1');
    for (const table of grid.tables) {
      for (const row of table.rows) {
        row.items = row.items.map((item, column) =>
          column === 0 || item.trim() === ''
            ? item
            : new Decimal(item.replace(',', '.')).plus(amount).toFixed(2).replace('.', ','),
        );
      }
    }
    return JSON.stringify(grid);
  };

  it('accepts cumulative interest well above the 100 zł nominal', () => {
    expect(() => parseInterestTable(shiftedBy('100'), key(2, 1))).not.toThrow();
    expect(parseInterestTable(shiftedBy('100'), key(2, 1)).dailyValues[0]).toEqual(pln('106.26'));
  });

  it('still refuses a cell no bond could ever carry', () => {
    // The widened band is a check, not a rubber stamp: a shifted decimal point
    // or a column read as groszy would land here, and writing it would re-value
    // every holding of the series against a number nobody published.
    const grid = asGrid('edo0735-2-1');
    grid.tables[0]!.rows[1]!.items[1] = '62600,00';

    try {
      parseInterestTable(JSON.stringify(grid), key(2, 1));
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(UnreadableInterestTableError);
      expect((error as Error).message).toContain('62600');
    }
  });

  it('names the band it actually enforces', () => {
    // The band has already been widened once. A message that still quotes the
    // old ceiling sends the next reader after a bug that was fixed, which is
    // exactly how the CPI adapter's refusal went stale against its constant.
    try {
      parseInterestTable(shiftedBy('20000'), key(2, 1));
      expect.unreachable('should have refused');
    } catch (error) {
      const text = (error as Error).message;
      expect(text).toContain('10000');
      expect(text).not.toContain('0–100 zł');
    }
  });
});
