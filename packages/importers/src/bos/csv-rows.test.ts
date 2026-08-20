import { currency } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { BOS_HEADER } from './layout';
import { readBosRows } from './csv-rows';

function csv(dataLines: readonly string[]): string {
  return [BOS_HEADER, ...dataLines].join('\n') + '\n';
}

describe('readBosRows', () => {
  it('parses a plain deposit row into date, title, empty details, amount, currency, lineIndex 0', () => {
    const rows = readBosRows(csv(['2026-01-05;Przelew do DM BOŚ;;5000,00;PLN']));

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.date.toString()).toBe('2026-01-05');
    expect(row?.title).toBe('Przelew do DM BOŚ');
    expect(row?.details).toBe('');
    expect(row?.amount.toString()).toBe('5000');
    expect(row?.currency).toBe(currency('PLN'));
    expect(row?.lineIndex).toBe(0);
  });

  it('parses a comma-decimal amount, including a negative one, via Decimal rather than Number', () => {
    const rows = readBosRows(
      csv(['2026-01-15;Rozliczenie transakcji kupna:;details here;-502,50;EUR']),
    );

    expect(rows[0]?.amount.toString()).toBe('-502.5');
  });

  it('assigns lineIndex sequentially across multiple valid data rows', () => {
    const rows = readBosRows(
      csv([
        '2026-01-05;Przelew do DM BOŚ;;5000,00;PLN',
        '2026-01-06;Przelew do DM BOŚ;;1000,00;PLN',
        '2026-01-07;Przelew do DM BOŚ;;2000,00;PLN',
      ]),
    );

    expect(rows.map((row) => row.lineIndex)).toEqual([0, 1, 2]);
  });

  it('skips a line with too few fields', () => {
    const rows = readBosRows(csv(['2026-01-05;Przelew do DM BOŚ;;5000,00']));

    expect(rows).toHaveLength(0);
  });

  it('skips a line with too many fields', () => {
    const rows = readBosRows(csv(['2026-01-05;Przelew do DM BOŚ;;5000,00;PLN;extra']));

    expect(rows).toHaveLength(0);
  });

  it('skips a line with an unparseable date', () => {
    const rows = readBosRows(csv(['not-a-date;Przelew do DM BOŚ;;5000,00;PLN']));

    expect(rows).toHaveLength(0);
  });

  it('skips a line with an unparseable amount', () => {
    const rows = readBosRows(csv(['2026-01-05;Przelew do DM BOŚ;;not-a-number;PLN']));

    expect(rows).toHaveLength(0);
  });

  it('skips a line with an unparseable currency', () => {
    const rows = readBosRows(csv(['2026-01-05;Przelew do DM BOŚ;;5000,00;NOTACURRENCY']));

    expect(rows).toHaveLength(0);
  });

  it('does not let a skipped malformed line consume a lineIndex', () => {
    const rows = readBosRows(
      csv([
        '2026-01-05;Przelew do DM BOŚ;;5000,00;PLN',
        'garbage;line;with;too;many;fields',
        '2026-01-06;Przelew do DM BOŚ;;1000,00;PLN',
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.lineIndex)).toEqual([0, 1]);
  });

  it('ignores blank lines between data rows (e.g. a trailing newline at end of file)', () => {
    const rows = readBosRows(`${BOS_HEADER}\n2026-01-05;Przelew do DM BOŚ;;5000,00;PLN\n\n`);

    expect(rows).toHaveLength(1);
  });

  it('returns no rows for a file with only a header', () => {
    const rows = readBosRows(`${BOS_HEADER}\n`);

    expect(rows).toHaveLength(0);
  });

  it('parses the szczegóły column verbatim on a buy row (interpretation happens elsewhere)', () => {
    const details =
      'Vanguard FTSE All-World UCITS ETF (IE00B3RBWM25) 10 x 100.00 EUR nr Z00000000001';
    const rows = readBosRows(
      csv([`2026-01-10;Rozliczenie transakcji kupna:;${details};-1000,00;EUR`]),
    );

    expect(rows[0]?.details).toBe(details);
  });
});
