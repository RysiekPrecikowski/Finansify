import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import type { Worksheet } from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  CLOSED_POSITIONS_DATA_START_ROW,
  CLOSED_POSITIONS_FOOTER_MARKER,
  OPEN_POSITIONS_DATA_START_ROW,
  closedPositionsColumn,
  openPositionsColumn,
} from './layout';
import { readClosedPositionTickers, readOpenPositionAggregates } from './positions';

interface OpenRow {
  readonly ticker: string | null;
  readonly volume: number | null;
  /** Populated on a per-lot row (`BUY`/`SELL`); left unset for an aggregate row. */
  readonly type?: string;
}

function openPositionsSheet(rows: readonly OpenRow[]): Worksheet {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Open Positions');
  rows.forEach((row, index) => {
    const r = sheet.getRow(OPEN_POSITIONS_DATA_START_ROW + index);
    if (row.ticker !== null) r.getCell(openPositionsColumn.ticker).value = row.ticker;
    if (row.type !== undefined) r.getCell(openPositionsColumn.type).value = row.type;
    if (row.volume !== null) r.getCell(openPositionsColumn.volume).value = row.volume;
  });
  return sheet;
}

interface ClosedRow {
  readonly instrument: string;
  readonly ticker: string | null;
}

function closedPositionsSheet(rows: readonly ClosedRow[]): Worksheet {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Closed Positions');
  rows.forEach((row, index) => {
    const r = sheet.getRow(CLOSED_POSITIONS_DATA_START_ROW + index);
    r.getCell(closedPositionsColumn.instrument).value = row.instrument;
    if (row.ticker !== null) r.getCell(closedPositionsColumn.ticker).value = row.ticker;
  });
  return sheet;
}

describe('readOpenPositionAggregates', () => {
  it('normalizes every ticker to market-symbol form, the same as map-operation.ts', () => {
    const sheet = openPositionsSheet([
      { ticker: 'XTB.PL', volume: 14.5 },
      { ticker: 'VWRD.UK', volume: 3 },
      { ticker: 'VWRL.NL', volume: 2 },
      { ticker: 'ADC.US', volume: 1 },
      { ticker: 'SXR8.DE', volume: 5 },
    ]);

    const result = readOpenPositionAggregates(sheet);

    expect(result.get('XTB.WA')?.toString()).toBe('14.5');
    expect(result.get('VWRD.L')?.toString()).toBe('3');
    expect(result.get('VWRL.AS')?.toString()).toBe('2');
    expect(result.get('ADC')?.toString()).toBe('1');
    expect(result.get('SXR8.DE')?.toString()).toBe('5');
    // Confirms the raw, un-normalized ticker is never used as a key.
    expect(result.has('XTB.PL')).toBe(false);
  });

  it('returns a Decimal, not a native number, for the volume', () => {
    const sheet = openPositionsSheet([{ ticker: 'XTB.PL', volume: 14.5 }]);

    expect(readOpenPositionAggregates(sheet).get('XTB.WA')).toBeInstanceOf(Decimal);
  });

  it('skips a per-lot row (a populated Type column) — only aggregate rows count', () => {
    const sheet = openPositionsSheet([{ ticker: 'XTB.PL', volume: 1, type: 'BUY' }]);

    expect(readOpenPositionAggregates(sheet).size).toBe(0);
  });

  it('skips a row with no ticker', () => {
    const sheet = openPositionsSheet([{ ticker: null, volume: 5 }]);

    expect(readOpenPositionAggregates(sheet).size).toBe(0);
  });

  it('skips a row with no volume', () => {
    const sheet = openPositionsSheet([{ ticker: 'XTB.PL', volume: null }]);

    expect(readOpenPositionAggregates(sheet).size).toBe(0);
  });

  it('returns an empty map for a sheet with no data rows', () => {
    const sheet = openPositionsSheet([]);

    expect(readOpenPositionAggregates(sheet).size).toBe(0);
  });
});

describe('readClosedPositionTickers', () => {
  it('normalizes every ticker to market-symbol form, the same as map-operation.ts', () => {
    const sheet = closedPositionsSheet([
      { instrument: 'XTB', ticker: 'XTB.PL' },
      { instrument: 'Vanguard FTSE All-World', ticker: 'VWRD.UK' },
    ]);

    const result = readClosedPositionTickers(sheet);

    expect(result.has('XTB.WA')).toBe(true);
    expect(result.has('VWRD.L')).toBe(true);
    expect(result.has('XTB.PL')).toBe(false);
  });

  it('skips the Profit/loss footer row', () => {
    const sheet = closedPositionsSheet([
      { instrument: 'XTB', ticker: 'XTB.PL' },
      { instrument: CLOSED_POSITIONS_FOOTER_MARKER, ticker: '15' },
    ]);

    const result = readClosedPositionTickers(sheet);

    expect(result.size).toBe(1);
    expect(result.has('XTB.WA')).toBe(true);
  });

  it('skips a row with no ticker', () => {
    const sheet = closedPositionsSheet([{ instrument: 'Something', ticker: null }]);

    expect(readClosedPositionTickers(sheet).size).toBe(0);
  });
});

describe('positions.ts normalization stays consistent with the Cash Operations join key', () => {
  it('produces the exact ticker key that instrumentOf (map-operation.ts) would put on ParsedRow.instrument.symbol', () => {
    // This is the entire reason normalizeXtbTicker had to be applied here too,
    // not just in map-operation.ts: reconcile() joins a Cash Operations-derived
    // ParsedRow to an Open Positions aggregate by ticker *string equality*
    // (reconciliation.ts reads openVolumeByTicker.get(row.instrument.symbol)).
    // If this map's keys were left as XTB's raw ".UK"/".NL"/".PL" tickers while
    // ParsedRow.instrument.symbol is normalized, every non-.DE ticker would
    // fail to join — producing a false "no counterpart" statement warning on
    // every real open position.
    const sheet = openPositionsSheet([
      { ticker: 'VWRD.UK', volume: 3 },
      { ticker: 'VWRL.NL', volume: 2 },
    ]);

    const openVolumeByTicker = readOpenPositionAggregates(sheet);

    expect([...openVolumeByTicker.keys()].sort()).toEqual(['VWRD.L', 'VWRL.AS']);
  });
});
