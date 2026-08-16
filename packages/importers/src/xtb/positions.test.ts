import Decimal from 'decimal.js';
import { Temporal } from '@finansify/core';
import ExcelJS from 'exceljs';
import type { Worksheet } from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  CLOSED_POSITIONS_DATA_START_ROW,
  CLOSED_POSITIONS_FOOTER_MARKER,
  closedPositionsColumn,
  findOpenPositionsHeaderRow,
  openPositionsColumn,
} from './layout';
import {
  readClosedPositionTickers,
  readOpenPositionAggregates,
  readOpenPositionLots,
} from './positions';

interface OpenRow {
  /** Aggregate row's own instrument name, or a per-lot row's numeric position id — whichever `instrumentOrPosition` holds. */
  readonly positionOrInstrument?: string | number | null;
  readonly ticker: string | null;
  readonly volume: number | null;
  /** Populated on a per-lot row (`BUY`/`SELL`); left unset for an aggregate row. */
  readonly type?: string;
  readonly openPrice?: number | null;
  readonly openTime?: Date | null;
}

/**
 * Builds an `Open Positions` worksheet with a *real* header row (actual
 * `Product`/`Ticker` text `findOpenPositionsHeaderRow` scans for) at whatever
 * row the test wants — the header sits at a different row per real account
 * (row 9 with no Investment Plan summary block, row 11 with one), so nothing
 * here may assume a fixed offset.
 */
function openPositionsSheet(rows: readonly OpenRow[], headerRow = 11): Worksheet {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Open Positions');

  const header = sheet.getRow(headerRow);
  header.getCell(openPositionsColumn.product).value = 'Product';
  header.getCell(openPositionsColumn.instrumentOrPosition).value = 'Instrument/Position';
  header.getCell(openPositionsColumn.ticker).value = 'Ticker';
  header.getCell(openPositionsColumn.category).value = 'Category';
  header.getCell(openPositionsColumn.type).value = 'Type';
  header.getCell(openPositionsColumn.volume).value = 'Volume';

  rows.forEach((row, index) => {
    const r = sheet.getRow(headerRow + 1 + index);
    if (row.positionOrInstrument !== undefined && row.positionOrInstrument !== null) {
      r.getCell(openPositionsColumn.instrumentOrPosition).value = row.positionOrInstrument;
    }
    if (row.ticker !== null) r.getCell(openPositionsColumn.ticker).value = row.ticker;
    if (row.type !== undefined) r.getCell(openPositionsColumn.type).value = row.type;
    if (row.volume !== null && row.volume !== undefined) {
      r.getCell(openPositionsColumn.volume).value = row.volume;
    }
    if (row.openPrice !== undefined && row.openPrice !== null) {
      r.getCell(openPositionsColumn.openPrice).value = row.openPrice;
    }
    if (row.openTime !== undefined && row.openTime !== null) {
      r.getCell(openPositionsColumn.openTime).value = row.openTime;
    }
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

describe('findOpenPositionsHeaderRow', () => {
  it('finds the header at row 9 — a real account with no Investment Plans summary block', () => {
    const sheet = openPositionsSheet([{ ticker: 'XTB.PL', volume: 1 }], 9);

    expect(findOpenPositionsHeaderRow(sheet)).toBe(9);
  });

  it('finds the header at row 11 — a real account with an Investment Plans summary block', () => {
    const sheet = openPositionsSheet([{ ticker: 'XTB.PL', volume: 1 }], 11);

    expect(findOpenPositionsHeaderRow(sheet)).toBe(11);
  });

  it('is not fooled by a row that only half-matches the header signature', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Open Positions');
    // "Product" in the right column, but the Ticker column says something
    // else entirely — this must not be mistaken for the real header.
    sheet.getRow(6).getCell(openPositionsColumn.product).value = 'Product';
    sheet.getRow(6).getCell(openPositionsColumn.ticker).value = 'Something Else';
    const realHeader = sheet.getRow(9);
    realHeader.getCell(openPositionsColumn.product).value = 'Product';
    realHeader.getCell(openPositionsColumn.ticker).value = 'Ticker';

    expect(findOpenPositionsHeaderRow(sheet)).toBe(9);
  });

  it('returns null when the sheet has no recognizable header at all', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Open Positions');
    sheet.getRow(1).getCell(1).value = 'Account number';

    expect(findOpenPositionsHeaderRow(sheet)).toBeNull();
  });
});

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

  it('reads aggregates correctly when the header sits at row 9, not just row 11', () => {
    // Proves the aggregate reader is driven by the dynamic header lookup, not
    // still secretly hardcoded to a specific row number.
    const sheet = openPositionsSheet([{ ticker: 'XTB.PL', volume: 14.5 }], 9);

    expect(readOpenPositionAggregates(sheet).get('XTB.WA')?.toString()).toBe('14.5');
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

  it('returns an empty map when the sheet has no recognizable header at all', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Open Positions');

    expect(readOpenPositionAggregates(sheet).size).toBe(0);
  });
});

describe('readOpenPositionLots', () => {
  const openTime = new Date('2024-08-01T08:00:00Z');

  it('reads a per-lot row into an OpenPositionLot, ticker normalized the same as the aggregate reader', () => {
    const sheet = openPositionsSheet([
      {
        positionOrInstrument: '1000000005',
        ticker: 'SPIN.PL',
        type: 'BUY',
        volume: 8,
        openPrice: 0.01,
        openTime,
      },
    ]);

    const lots = readOpenPositionLots(sheet);

    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      positionId: '1000000005',
      ticker: 'SPIN.WA',
    });
    expect(lots[0]!.volume).toBeInstanceOf(Decimal);
    expect(lots[0]!.volume.toString()).toBe('8');
    expect(lots[0]!.openPrice).toBeInstanceOf(Decimal);
    expect(lots[0]!.openPrice.toString()).toBe('0.01');
    expect(
      lots[0]!.openTime.equals(Temporal.Instant.fromEpochMilliseconds(openTime.getTime())),
    ).toBe(true);
  });

  it('reads a SELL lot the same way as a BUY lot — the row marker itself is not carried into the record', () => {
    const sheet = openPositionsSheet([
      {
        positionOrInstrument: '42',
        ticker: 'XTB.PL',
        type: 'SELL',
        volume: 2,
        openPrice: 10,
        openTime,
      },
    ]);

    const lots = readOpenPositionLots(sheet);

    expect(lots).toHaveLength(1);
    expect(lots[0]!.positionId).toBe('42');
    // OpenPositionLot carries no BUY/SELL field at all — mapOpenPositionLot
    // always produces transfer_in regardless.
    expect(Object.keys(lots[0]!)).not.toContain('type');
  });

  it('excludes aggregate rows (empty Type column) — only per-lot rows are lots', () => {
    const sheet = openPositionsSheet([
      { positionOrInstrument: 'Spinoff Co', ticker: 'SPIN.PL', volume: 8 }, // aggregate
      {
        positionOrInstrument: '1000000005',
        ticker: 'SPIN.PL',
        type: 'BUY',
        volume: 8,
        openPrice: 0.01,
        openTime,
      },
    ]);

    const lots = readOpenPositionLots(sheet);

    expect(lots).toHaveLength(1);
    expect(lots[0]!.positionId).toBe('1000000005');
  });

  it('finds lots correctly when the header sits at row 9, not just row 11', () => {
    const sheet = openPositionsSheet(
      [
        {
          positionOrInstrument: '1000000005',
          ticker: 'SPIN.PL',
          type: 'BUY',
          volume: 8,
          openPrice: 0.01,
          openTime,
        },
      ],
      9,
    );

    expect(readOpenPositionLots(sheet)).toHaveLength(1);
  });

  it('returns an empty array for a sheet with no recognizable header at all', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Open Positions');

    expect(readOpenPositionLots(sheet)).toEqual([]);
  });

  const completeLot = {
    positionOrInstrument: '1000000005',
    ticker: 'SPIN.PL',
    type: 'BUY',
    volume: 8,
    openPrice: 0.01,
    openTime,
  };

  it.each([
    ['ticker', { ...completeLot, ticker: null }],
    ['positionId', { ...completeLot, positionOrInstrument: null }],
    ['volume', { ...completeLot, volume: null }],
    ['openPrice', { ...completeLot, openPrice: null }],
    ['openTime', { ...completeLot, openTime: null }],
  ] satisfies [string, OpenRow][])(
    'skips a lot row missing %s rather than guessing at it',
    (_label, incompleteRow) => {
      const sheet = openPositionsSheet([incompleteRow, completeLot]);

      const lots = readOpenPositionLots(sheet);

      // The complete row after it is still read — one bad row doesn't sink
      // the whole sheet.
      expect(lots).toHaveLength(1);
      expect(lots[0]!.positionId).toBe('1000000005');
    },
  );
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
