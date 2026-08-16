import Decimal from 'decimal.js';
import { Temporal } from '@finansify/core';
import type { Cell, Worksheet } from 'exceljs';

/**
 * Row/column layout of an XTB xlsx export, confirmed against real exports
 * across all three of a user's accounts (EUR/PLN/USD). Every sheet opens with
 * `Account number` / a title row / a date-range row before its real header.
 * `Cash Operations` and `Closed Positions` always put theirs at row 5 — no
 * summary sub-table precedes either, confirmed across all three accounts.
 * `Open Positions` is different: it carries a `My Trades` summary sub-table
 * always, and an `Investment Plans` one too on any account that has one —
 * so its header sits at a *different* row per account (row 9 with no
 * Investment Plan, row 11 with one, both confirmed against real accounts)
 * rather than a fixed offset. `findOpenPositionsHeaderRow` below locates it
 * by its own signature instead of assuming a row number, which is what a
 * fixed `OPEN_POSITIONS_HEADER_ROW = 11` got wrong for the PLN account: it
 * silently skipped that account's first-listed ticker's own aggregate row.
 */
export const SHEET_NAMES = {
  cashOperations: 'Cash Operations',
  openPositions: 'Open Positions',
  closedPositions: 'Closed Positions',
} as const;

export const CASH_OPERATIONS_HEADER_ROW = 5;
export const CASH_OPERATIONS_DATA_START_ROW = 6;

export const cashOperationsColumn = {
  type: 1,
  instrument: 2,
  ticker: 3,
  category: 4,
  time: 5,
  amount: 6,
  id: 7,
  comment: 8,
  product: 9,
  positionId: 10,
} as const;

export const openPositionsColumn = {
  product: 1,
  /** The instrument's own product name on an aggregate row; the position's own numeric id on a per-lot row. */
  instrumentOrPosition: 2,
  ticker: 3,
  category: 4,
  /** Empty on an aggregate (per-instrument) row; `BUY`/`SELL` on a per-lot row. */
  type: 5,
  volume: 6,
  openPrice: 9,
  openTime: 10,
} as const;

/**
 * Scans for the row whose first two relevant columns read `Product`/`Ticker`
 * — see the module doc for why this can't be a fixed row number. `null` only
 * if the sheet's shape has changed enough that nothing recognizable is here
 * at all; `sniff()` already refused a file with no `Open Positions` sheet, so
 * callers treat this as "no positions to reconcile against" rather than an
 * error.
 */
export function findOpenPositionsHeaderRow(worksheet: Worksheet): number | null {
  for (let row = 1; row <= worksheet.rowCount; row++) {
    if (
      cellString(worksheet, row, openPositionsColumn.product) === 'Product' &&
      cellString(worksheet, row, openPositionsColumn.ticker) === 'Ticker'
    ) {
      return row;
    }
  }
  return null;
}

export const CLOSED_POSITIONS_HEADER_ROW = 5;
export const CLOSED_POSITIONS_DATA_START_ROW = 6;

export const closedPositionsColumn = {
  instrument: 1,
  ticker: 2,
  category: 3,
  type: 4,
  volume: 5,
} as const;

/** The `Closed Positions` sheet ends in a `Profit/loss` summary row, not a data row. */
export const CLOSED_POSITIONS_FOOTER_MARKER = 'Profit/loss';
/** `Cash Operations` ends in a `Total` row under the `Type` column, not a real operation. */
export const CASH_OPERATIONS_FOOTER_TYPE = 'Total';

export function cellString(worksheet: Worksheet, row: number, column: number): string | null {
  const value = worksheet.getRow(row).getCell(column).value;
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function cellDecimal(worksheet: Worksheet, row: number, column: number): Decimal | null {
  const value = worksheet.getRow(row).getCell(column).value;
  if (typeof value !== 'number') return null;
  return new Decimal(value);
}

/**
 * XTB's `(UTC)` columns come back from `exceljs` as a native `Date`. Every
 * observed timestamp column in this export is UTC — the sheet's own
 * `Date from/to (UTC)` range headers say so, and `Open`/`Close Time (UTC)`
 * repeat it explicitly; `Cash Operations`' bare `Time` column is treated the
 * same way for consistency rather than assumed local.
 */
export function cellInstant(
  worksheet: Worksheet,
  row: number,
  column: number,
): Temporal.Instant | null {
  const value = worksheet.getRow(row).getCell(column).value as Cell['value'];
  if (!(value instanceof Date)) return null;
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

/**
 * A Polish investor's own trading day, not UTC's — the same reasoning ADR
 * 0007 already applies to trade dates generally: the civil day that matters
 * is the investor's, and converting late-UTC-evening trades straight to a
 * bare UTC date would occasionally book them a day early.
 */
export function instantToWarsawDate(instant: Temporal.Instant): Temporal.PlainDate {
  return instant.toZonedDateTimeISO('Europe/Warsaw').toPlainDate();
}
