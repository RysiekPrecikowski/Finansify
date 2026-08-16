import Decimal from 'decimal.js';
import { Temporal } from '@finansify/core';
import type { Cell, Worksheet } from 'exceljs';

/**
 * Row/column layout of an XTB xlsx export, confirmed against real exports
 * across all three of a user's accounts (EUR/PLN/USD). Every sheet opens with
 * `Account number` / a title row / a date-range row before its real header —
 * `Open Positions` additionally carries a summary sub-table (aggregate value
 * and profit per product) before its per-instrument header, which is why its
 * header row sits four rows later than the other two.
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

export const OPEN_POSITIONS_HEADER_ROW = 11;
export const OPEN_POSITIONS_DATA_START_ROW = 12;

export const openPositionsColumn = {
  product: 1,
  instrumentOrPosition: 2,
  ticker: 3,
  category: 4,
  /** Empty on an aggregate (per-instrument) row; `BUY`/`SELL` on a per-lot row. */
  type: 5,
  volume: 6,
} as const;

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
