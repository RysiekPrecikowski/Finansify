import type Decimal from 'decimal.js';
import { type Temporal } from '@finansify/core';
import type { Worksheet } from 'exceljs';

import {
  CASH_OPERATIONS_DATA_START_ROW,
  CASH_OPERATIONS_FOOTER_TYPE,
  cashOperationsColumn,
  cellDecimal,
  cellInstant,
  cellString,
} from './layout';

/** One row of the `Cash Operations` sheet, read but not yet interpreted. */
export interface CashOperationRow {
  readonly type: string;
  readonly ticker: string | null;
  readonly time: Temporal.Instant;
  /** Signed, exactly as the sheet reports it — direction lives in `type`, not here. */
  readonly amount: Decimal;
  readonly id: string;
  readonly comment: string;
}

/** Every row between the header and the `Total` footer, footer excluded. */
export function readCashOperations(worksheet: Worksheet): readonly CashOperationRow[] {
  const rows: CashOperationRow[] = [];

  for (let row = CASH_OPERATIONS_DATA_START_ROW; row <= worksheet.rowCount; row++) {
    const type = cellString(worksheet, row, cashOperationsColumn.type);
    if (type === null || type === CASH_OPERATIONS_FOOTER_TYPE) continue;

    // A row with a `Type` but no `Time`/`Amount`/`ID` has never been seen in a
    // real export — treated as a stray formatting artifact rather than data
    // worth a warning over. If that assumption turns out wrong, it will show
    // up as a row count that doesn't match the statement, not a silent loss
    // of money: `Type` is what every real row has, and this is the one
    // combination that never occurs alongside it.
    const time = cellInstant(worksheet, row, cashOperationsColumn.time);
    const amount = cellDecimal(worksheet, row, cashOperationsColumn.amount);
    const id = cellString(worksheet, row, cashOperationsColumn.id);
    if (time === null || amount === null || id === null) continue;

    rows.push({
      type,
      ticker: cellString(worksheet, row, cashOperationsColumn.ticker),
      time,
      amount,
      id,
      comment: cellString(worksheet, row, cashOperationsColumn.comment) ?? '',
    });
  }

  return rows;
}
