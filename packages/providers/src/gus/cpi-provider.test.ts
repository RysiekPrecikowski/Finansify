import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ImplausibleCpiError, parseCpiCsv } from './cpi-provider';

/**
 * The fixture is a real slice of the GUS file, still in Windows-1250 — decoding
 * it here the way the provider does is part of what these tests cover.
 */
const raw = readFileSync(join(import.meta.dirname, '__fixtures__', 'cpi-monthly.csv'));
const csv = new TextDecoder('windows-1250').decode(raw);

describe('parseCpiCsv', () => {
  it('reads only the year-on-year presentation', () => {
    const observations = parseCpiCsv(csv);

    expect(observations.length).toBeGreaterThan(0);
    // The file also carries "Poprzedni miesiąc = 100", "Grudzień poprzedniego
    // roku = 100" and two more; taking those would index bonds against the
    // wrong series entirely.
    expect(observations.every((o) => o.indexId === 'pl_cpi_yoy')).toBe(true);
  });

  it('converts the index to a rate', () => {
    // 102,1 as published means 2.1% year-on-year.
    const january = parseCpiCsv(csv).find((o) => o.effectiveFrom.toString() === '2026-02-01');
    expect(january?.value.toFixed(4)).toBe('0.0210');
  });

  it('dates an observation by its announcement month, not the month it describes', () => {
    // March 2026's figure is announced in April, so it may govern an interest
    // period starting in April. Dating it to March would let a period starting
    // 2026-03-15 use a print that did not exist yet.
    const dates = parseCpiCsv(csv).map((o) => o.effectiveFrom.toString());
    expect(dates).toContain('2026-04-01');
  });

  it('skips unpublished months instead of reading a blank as zero', () => {
    // A blank parsed as a number is 0, which would read as 100% deflation and
    // re-rate every indexed bond to its bare margin.
    const observations = parseCpiCsv(csv);
    expect(observations.every((o) => !o.value.equals(-1))).toBe(true);
    expect(observations.length).toBeLessThan(csv.split('\n').length - 1);
  });

  it('handles the Polish characters the filter depends on', () => {
    // Read as UTF-8 the presentation column mangles and matches nothing, so a
    // non-empty result is itself the encoding assertion.
    expect(parseCpiCsv(csv).length).toBeGreaterThan(0);
  });

  it('returns the series oldest first', () => {
    const dates = parseCpiCsv(csv).map((o) => o.effectiveFrom.toString());
    expect(dates).toEqual([...dates].sort());
  });

  it('carries deflation through as a negative rate rather than flooring it here', () => {
    // The zero floor is a property of the bond's terms, applied by `accrueBond`.
    // An adapter that floors would make a real deflationary print unrecoverable.
    const deflation = [
      'Nazwa;Jednostka;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga',
      'CPI;Polska;Analogiczny miesiąc poprzedniego roku = 100;2015;7;99,2;',
    ].join('\n');

    expect(parseCpiCsv(deflation)[0]?.value.toFixed(4)).toBe('-0.0080');
  });
});

describe('refusing implausible values', () => {
  const row = (value: string) =>
    [
      'Nazwa;Jednostka;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga',
      `CPI;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;7;${value};`,
    ].join('\n');

  // A blank cell is a *published-yet* question and is skipped; an unreadable
  // one is a parser question and must be refused, never silently dropped.
  it.each(['0', '5,0', '3000,0', 'b.d.', '-'])('refuses %s rather than writing it', (value) => {
    expect(() => parseCpiCsv(row(value))).toThrow(ImplausibleCpiError);
  });

  it.each([
    // The file's actual extremes. A ceiling that excluded either of these
    // would reject real published data — which is exactly what an earlier,
    // tighter band did, and it took the whole CPI series down with it.
    ['1283,1', 'February 1990, the series maximum'],
    ['98,4', 'February 2015, deflation'],
  ])('accepts %s — %s', (value) => {
    expect(() => parseCpiCsv(row(value))).not.toThrow();
  });

  it('still catches a shifted column in either direction', () => {
    // A year lands above the ceiling, a month below the floor.
    expect(() => parseCpiCsv(row('2026'))).toThrow(ImplausibleCpiError);
    expect(() => parseCpiCsv(row('7'))).toThrow(ImplausibleCpiError);
  });
});
