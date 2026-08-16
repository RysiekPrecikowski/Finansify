/**
 * Builds `xtb-sample.xlsx` from scratch — every value here is invented, never
 * copied from a real export (real exports are gitignored under `__private/`
 * and never committed, even in part). Structurally it matches a real XTB
 * export exactly (sheet names, header rows, column order), confirmed against
 * the user's own real exports during planning; the numbers are fiction
 * designed to exercise every case the parser has to handle:
 *
 * - `ETFX.PL`: a clean, same-currency position — single-fill and split-fill
 *   purchases (the `qty/total @ price` comment grammar), a partial sell, a
 *   dividend and its withholding tax. Reconciles cleanly against its Open
 *   Positions aggregate row.
 * - `FORX.US`: same shape, but every fill prices at a consistent ~0.92 ratio
 *   of amount to quantity×price — an FX-converted ticker, for the
 *   median-ratio inference to find.
 * - Two eWallet rows (`DIR:B2I`/`DIR:I2B`) that are plain `Deposit`/
 *   `Withdrawal` by `Type` — proving they need no special-casing at all.
 * - A `Subaccount transfer` pair and a `Transfer` pair, each netting to
 *   exactly zero — the real, verified reason these are dropped rather than
 *   modeled as anything.
 * - `SPLT.PL`: a stock-split cluster — a real-money `Fractional shares` row
 *   alongside zero-amount `Commission`/`Correction`/`Close trade` rows tied
 *   to the same position id.
 * - `MISM.PL`: cash-derived quantity disagrees with its Open Positions
 *   aggregate row — a reconciliation mismatch.
 * - `LOST.PL`: a cash-derived open quantity with no counterpart in either
 *   Open or Closed Positions at all — the "missing position" case.
 * - `SPIN.PL`: a spin-off with zero rows anywhere in Cash Operations, but an
 *   aggregate row and a per-lot `BUY` row in Open Positions — recovered as a
 *   `transfer_in` row from the lot instead, which then reconciles cleanly
 *   against the very aggregate row it was recovered from.
 * - A `Total` footer row in Cash Operations, and a `Profit/loss` footer row
 *   in Closed Positions — both must be skipped, not parsed as data.
 *
 * Run with `pnpm --filter @finansify/importers fixture:generate`. Regenerate
 * whenever the fixture needs a new case; do not hand-edit the `.xlsx`.
 */
// `exceljs` ships CJS-only, so the default import (its `module.exports`
// object) is the only reliable way to reach it under real ESM — named
// imports resolve only as much as `cjs-module-lexer` can statically detect,
// which does not cover this package's export shape.
import ExcelJS, { type Worksheet } from 'exceljs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { Workbook } = ExcelJS;
type Workbook = InstanceType<typeof ExcelJS.Workbook>;

import {
  SHEET_NAMES,
  cashOperationsColumn,
  closedPositionsColumn,
  openPositionsColumn,
} from '../layout';

const ACCOUNT_NUMBER = '9999999';
const REPORT_FROM = new Date('2024-01-01T00:00:00.000Z');
const REPORT_TO = new Date('2024-12-31T23:00:00.000Z');

function reportHeaderRows(
  title: string,
  extraDateRow: readonly [string, Date] | null = ['Date to (UTC)', REPORT_TO],
): (readonly [string, unknown])[] {
  const rows: (readonly [string, unknown])[] = [
    ['Account number', ACCOUNT_NUMBER],
    [title, ''],
  ];
  if (extraDateRow !== null) {
    rows.push(['Date from (UTC)', REPORT_FROM], extraDateRow);
  } else {
    rows.push(['Data as of report generated', REPORT_TO]);
  }
  return rows;
}

function writeLeadingRows(worksheet: Worksheet, rows: readonly (readonly [string, unknown])[]) {
  rows.forEach((row, index) => {
    worksheet.getRow(index + 1).getCell(1).value = row[0];
    worksheet.getRow(index + 1).getCell(2).value = row[1] as never;
  });
}

function time(iso: string): Date {
  return new Date(iso);
}

function buildCashOperations(workbook: Workbook) {
  const sheet = workbook.addWorksheet(SHEET_NAMES.cashOperations);
  writeLeadingRows(sheet, reportHeaderRows('Cash Operations'));

  const headerRow = sheet.getRow(5);
  headerRow.getCell(cashOperationsColumn.type).value = 'Type';
  headerRow.getCell(cashOperationsColumn.instrument).value = 'Instrument';
  headerRow.getCell(cashOperationsColumn.ticker).value = 'Ticker';
  headerRow.getCell(cashOperationsColumn.category).value = 'Category';
  headerRow.getCell(cashOperationsColumn.time).value = 'Time';
  headerRow.getCell(cashOperationsColumn.amount).value = 'Amount';
  headerRow.getCell(cashOperationsColumn.id).value = 'ID';
  headerRow.getCell(cashOperationsColumn.comment).value = 'Comment';
  headerRow.getCell(cashOperationsColumn.product).value = 'Product';
  headerRow.getCell(cashOperationsColumn.positionId).value = 'Position ID';

  interface Row {
    readonly type: string;
    readonly instrument?: string;
    readonly ticker?: string;
    readonly category?: string;
    readonly time: Date;
    readonly amount: number;
    readonly id: string;
    readonly comment: string;
    readonly product?: string;
    readonly positionId?: string;
  }

  const rows: Row[] = [
    // Cash movements, including both eWallet directions — Type alone decides
    // deposit vs withdrawal; the DIR:/CID: fields are never inspected.
    {
      type: 'Deposit',
      time: time('2024-01-02T09:00:00Z'),
      amount: 5000,
      id: 'D1',
      comment: 'Bank transfer',
    },
    {
      type: 'Withdrawal',
      time: time('2024-01-05T09:00:00Z'),
      amount: -500,
      id: 'W1',
      comment: 'Bank transfer',
    },
    {
      type: 'Deposit',
      time: time('2024-01-06T09:00:00Z'),
      amount: 200,
      id: 'D2',
      comment:
        'eWallet OT|DIR:B2I|BA:1234567|IA:7654321|BR:PLPL|CID:aaaaaaaa-1111-4111-8111-111111111111',
    },
    {
      type: 'Withdrawal',
      time: time('2024-01-07T09:00:00Z'),
      amount: -200,
      id: 'W2',
      comment:
        'eWallet OT|DIR:I2B|BA:1234567|IA:7654321|BR:PLPL|CID:bbbbbbbb-2222-4222-8222-222222222222',
    },
    {
      type: 'Free funds interest',
      time: time('2024-02-01T00:00:00Z'),
      amount: 3.2,
      id: 'I1',
      comment: 'Free-funds Interest 2024-01',
    },
    {
      type: 'Free funds interest tax',
      time: time('2024-02-01T00:00:00Z'),
      amount: -0.61,
      id: 'IT1',
      comment: 'Free-funds Interest Tax 2024-01',
    },

    // ETFX.PL — clean, same-currency. Single fill, then a split fill pair
    // (the second fill's own quantity is the number *before* the slash; the
    // number after it is the position's running total, discarded).
    {
      type: 'Stock purchase',
      instrument: 'ETFX Fund',
      ticker: 'ETFX.PL',
      category: 'ETF',
      time: time('2024-03-01T08:00:00Z'),
      amount: -500,
      id: 'T1',
      comment: 'OPEN BUY 10 @ 50.00',
      product: 'My Trades',
      positionId: '1000000001',
    },
    {
      type: 'Stock purchase',
      instrument: 'ETFX Fund',
      ticker: 'ETFX.PL',
      category: 'ETF',
      time: time('2024-03-15T08:00:00Z'),
      amount: -102,
      id: 'T2',
      comment: 'OPEN BUY 2/7.5 @ 51.00',
      product: 'My Trades',
      positionId: '1000000002',
    },
    {
      type: 'Stock purchase',
      instrument: 'ETFX Fund',
      ticker: 'ETFX.PL',
      category: 'ETF',
      time: time('2024-03-15T08:00:05Z'),
      amount: -281.6,
      id: 'T3',
      comment: 'OPEN BUY 5.5/7.5 @ 51.20',
      product: 'My Trades',
      positionId: '1000000002',
    },
    {
      type: 'Stock sell',
      instrument: 'ETFX Fund',
      ticker: 'ETFX.PL',
      category: 'ETF',
      time: time('2024-06-01T08:00:00Z'),
      amount: 165,
      id: 'T4',
      comment: 'CLOSE BUY 3 @ 55.00',
      product: 'My Trades',
      positionId: '1000000001',
    },
    {
      type: 'Dividend',
      instrument: 'ETFX Fund',
      ticker: 'ETFX.PL',
      category: 'ETF',
      time: time('2024-07-01T08:00:00Z'),
      amount: 12.34,
      id: 'DIV1',
      comment: 'XTB.PL PLN 0.5000/ SHR',
    },
    {
      type: 'Withholding tax',
      instrument: 'ETFX Fund',
      ticker: 'ETFX.PL',
      category: 'ETF',
      time: time('2024-07-01T08:00:00Z'),
      amount: -1.85,
      id: 'WHT1',
      comment: 'XTB.PL PLN WHT 15%',
    },

    // FORX.US — FX-converted: amount is consistently ~0.92x quantity×price.
    {
      type: 'Stock purchase',
      instrument: 'Foreign Corp',
      ticker: 'FORX.US',
      category: 'STOCK',
      time: time('2024-04-01T08:00:00Z'),
      amount: -276,
      id: 'T5',
      comment: 'OPEN BUY 3 @ 100.00',
      product: 'My Trades',
      positionId: '1000000003',
    },
    {
      type: 'Stock purchase',
      instrument: 'Foreign Corp',
      ticker: 'FORX.US',
      category: 'STOCK',
      time: time('2024-04-10T08:00:00Z'),
      amount: -187.68,
      id: 'T6',
      comment: 'OPEN BUY 2 @ 102.00',
      product: 'My Trades',
      positionId: '1000000004',
    },

    // Nets to zero — dropped, not modeled (verified against real exports).
    {
      type: 'Subaccount transfer',
      time: time('2024-05-01T08:00:00Z'),
      amount: 1000,
      id: 'ST1',
      comment: 'Transfer from 1111111 to 2222222',
    },
    {
      type: 'Subaccount transfer',
      time: time('2024-05-01T08:00:01Z'),
      amount: -1000,
      id: 'ST2',
      comment: 'Transfer from 2222222 to 1111111',
    },
    {
      type: 'Transfer',
      time: time('2024-05-02T08:00:00Z'),
      amount: 300,
      id: 'TR1',
      comment: 'Transfer from 3333333 to 4444444',
    },
    {
      type: 'Transfer',
      time: time('2024-05-02T08:00:01Z'),
      amount: -300,
      id: 'TR2',
      comment: 'Transfer from 4444444 to 3333333',
    },

    // SPLT.PL — a stock-split cluster. Only Fractional shares moves cash.
    {
      type: 'Fractional shares',
      instrument: 'Splitter Co',
      ticker: 'SPLT.PL',
      category: 'STOCK',
      time: time('2024-08-01T08:00:00Z'),
      amount: 2.5,
      id: 'FS1',
      comment: 'SPLT.PL split 2 for 1',
      positionId: '1000000005',
    },
    {
      type: 'Commission',
      instrument: 'Splitter Co',
      ticker: 'SPLT.PL',
      category: 'STOCK',
      time: time('2024-08-01T08:00:00Z'),
      amount: 0,
      id: 'C1',
      comment: 'Correction: BUY 1.0000 @ 20.00',
      positionId: '1000000005',
    },
    {
      type: 'Correction',
      instrument: 'Splitter Co',
      ticker: 'SPLT.PL',
      category: 'STOCK',
      time: time('2024-08-01T08:00:00Z'),
      amount: 0,
      id: 'CR1',
      comment: 'Correction: Profit of position 1000000005',
      positionId: '1000000005',
    },
    {
      type: 'Close trade',
      instrument: 'Splitter Co',
      ticker: 'SPLT.PL',
      category: 'STOCK',
      time: time('2024-08-01T08:00:00Z'),
      amount: 0,
      id: 'CT1',
      comment: 'Profit of position 1000000005',
      positionId: '1000000005',
    },

    // MISM.PL — cash says 10 units; Open Positions (below) will say 6.
    {
      type: 'Stock purchase',
      instrument: 'Mismatch Co',
      ticker: 'MISM.PL',
      category: 'STOCK',
      time: time('2024-09-01T08:00:00Z'),
      amount: -300,
      id: 'T7',
      comment: 'OPEN BUY 10 @ 30.00',
      product: 'My Trades',
      positionId: '1000000006',
    },

    // LOST.PL — cash says 5 units bought; Open/Closed Positions say nothing
    // at all about this ticker.
    {
      type: 'Stock purchase',
      instrument: 'Lost Co',
      ticker: 'LOST.PL',
      category: 'STOCK',
      time: time('2024-09-05T08:00:00Z'),
      amount: -200,
      id: 'T8',
      comment: 'OPEN BUY 5 @ 40.00',
      product: 'My Trades',
      positionId: '1000000007',
    },
  ];

  rows.forEach((row, index) => {
    const r = sheet.getRow(6 + index);
    r.getCell(cashOperationsColumn.type).value = row.type;
    r.getCell(cashOperationsColumn.instrument).value = row.instrument ?? '';
    r.getCell(cashOperationsColumn.ticker).value = row.ticker ?? '';
    r.getCell(cashOperationsColumn.category).value = row.category ?? '';
    r.getCell(cashOperationsColumn.time).value = row.time;
    r.getCell(cashOperationsColumn.amount).value = row.amount;
    r.getCell(cashOperationsColumn.id).value = row.id;
    r.getCell(cashOperationsColumn.comment).value = row.comment;
    r.getCell(cashOperationsColumn.product).value = row.product ?? '';
    r.getCell(cashOperationsColumn.positionId).value = row.positionId ?? '';
  });

  const footerRow = sheet.getRow(6 + rows.length);
  footerRow.getCell(cashOperationsColumn.type).value = 'Total';
  footerRow.getCell(cashOperationsColumn.amount).value = 4924.4;
}

function buildOpenPositions(workbook: Workbook) {
  const sheet = workbook.addWorksheet(SHEET_NAMES.openPositions);
  writeLeadingRows(sheet, reportHeaderRows('Open Positions', null));

  const summaryHeader = sheet.getRow(4);
  summaryHeader.getCell(1).value = 'Product';
  summaryHeader.getCell(2).value = 'Metric';
  summaryHeader.getCell(3).value = 'Amount';
  summaryHeader.getCell(4).value = 'Currency';
  sheet.getRow(5).getCell(1).value = 'My Trades';
  sheet.getRow(5).getCell(2).value = 'Value';
  sheet.getRow(5).getCell(3).value = 999;
  sheet.getRow(5).getCell(4).value = 'PLN';

  sheet.getRow(10).getCell(1).value = 'Note';
  sheet.getRow(10).getCell(2).value =
    'Summary values and open positions are shown as of the report generation time';

  const headerRow = sheet.getRow(11);
  headerRow.getCell(openPositionsColumn.product).value = 'Product';
  headerRow.getCell(openPositionsColumn.instrumentOrPosition).value = 'Instrument/Position';
  headerRow.getCell(openPositionsColumn.ticker).value = 'Ticker';
  headerRow.getCell(openPositionsColumn.category).value = 'Category';
  headerRow.getCell(openPositionsColumn.type).value = 'Type';
  headerRow.getCell(openPositionsColumn.volume).value = 'Volume';

  interface Row {
    readonly instrument: string;
    readonly ticker: string;
    readonly volume: number;
  }

  // Aggregate rows only — per-lot rows aren't needed for reconciliation and
  // are left out of this fixture to keep it readable, except for SPIN.PL
  // below, whose own lot row is the entire point of that scenario.
  const rows: Row[] = [
    { instrument: 'ETFX Fund', ticker: 'ETFX.PL', volume: 14.5 },
    { instrument: 'Foreign Corp', ticker: 'FORX.US', volume: 5 },
    // Deliberately 6, not the cash-derived 10 — the reconciliation mismatch.
    { instrument: 'Mismatch Co', ticker: 'MISM.PL', volume: 6 },
    // Zero Cash Operations rows exist for this ticker at all — recovered
    // entirely from its own lot row below.
    { instrument: 'Spinoff Co', ticker: 'SPIN.PL', volume: 8 },
  ];

  rows.forEach((row, index) => {
    const r = sheet.getRow(12 + index);
    r.getCell(openPositionsColumn.product).value = 'My Trades';
    r.getCell(openPositionsColumn.instrumentOrPosition).value = row.instrument;
    r.getCell(openPositionsColumn.ticker).value = row.ticker;
    r.getCell(openPositionsColumn.category).value = 'STOCK';
    r.getCell(openPositionsColumn.type).value = '';
    r.getCell(openPositionsColumn.volume).value = row.volume;
  });

  // SPIN.PL's own per-lot row — a spin-off recorded here as a BUY at a
  // near-zero open price, the same shape confirmed against a real account
  // (Synektik spinning off into Syn2bio, never appearing on Cash Operations
  // at all). `readOpenPositionLots` reads this; the aggregate reader above
  // skips it because its Type column is populated.
  const lotRow = sheet.getRow(12 + rows.length);
  lotRow.getCell(openPositionsColumn.product).value = 'My Trades';
  lotRow.getCell(openPositionsColumn.instrumentOrPosition).value = '1000000009';
  lotRow.getCell(openPositionsColumn.ticker).value = 'SPIN.PL';
  lotRow.getCell(openPositionsColumn.category).value = 'STOCK';
  lotRow.getCell(openPositionsColumn.type).value = 'BUY';
  lotRow.getCell(openPositionsColumn.volume).value = 8;
  lotRow.getCell(openPositionsColumn.openPrice).value = 0.01;
  lotRow.getCell(openPositionsColumn.openTime).value = time('2024-08-15T08:00:00Z');
}

function buildClosedPositions(workbook: Workbook) {
  const sheet = workbook.addWorksheet(SHEET_NAMES.closedPositions);
  writeLeadingRows(sheet, reportHeaderRows('Closed Positions'));

  const headerRow = sheet.getRow(5);
  headerRow.getCell(closedPositionsColumn.instrument).value = 'Instrument';
  headerRow.getCell(closedPositionsColumn.ticker).value = 'Ticker';
  headerRow.getCell(closedPositionsColumn.category).value = 'Category';
  headerRow.getCell(closedPositionsColumn.type).value = 'Type';
  headerRow.getCell(closedPositionsColumn.volume).value = 'Volume';
  sheet.getRow(5).getCell(6).value = 'Open Price';
  sheet.getRow(5).getCell(7).value = 'Open Time (UTC)';
  sheet.getRow(5).getCell(8).value = 'Close Price';
  sheet.getRow(5).getCell(9).value = 'Close Time (UTC)';

  const row = sheet.getRow(6);
  row.getCell(closedPositionsColumn.instrument).value = 'ETFX Fund';
  row.getCell(closedPositionsColumn.ticker).value = 'ETFX.PL';
  row.getCell(closedPositionsColumn.category).value = 'ETF';
  row.getCell(closedPositionsColumn.type).value = 'BUY';
  row.getCell(closedPositionsColumn.volume).value = 3;
  row.getCell(6).value = 50;
  row.getCell(7).value = time('2024-03-01T08:00:00Z');
  row.getCell(8).value = 55;
  row.getCell(9).value = time('2024-06-01T08:00:00Z');

  const footerRow = sheet.getRow(7);
  footerRow.getCell(1).value = 'Profit/loss';
  footerRow.getCell(closedPositionsColumn.volume - 1).value = '15';
}

async function main() {
  const workbook = new Workbook();
  buildCashOperations(workbook);
  buildOpenPositions(workbook);
  buildClosedPositions(workbook);

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'xtb-sample.xlsx');
  await workbook.xlsx.writeFile(outPath);
  // A one-off script's status line, not application logging — `console.warn`
  // is the closest allowed method to a plain "done" message.
  console.warn(`Wrote ${outPath}`);
}

await main();
