// `exceljs` ships CJS-only — the default import is the only reliable way to
// reach it under real ESM (see `fixture/generate.ts`).
import ExcelJS from 'exceljs';
import {
  currency,
  type Confidence,
  type ParsedStatement,
  type RawFile,
  type StatementParser,
} from '@finansify/core';

import { readCashOperations } from './cash-operations';
import { inferFxRatios, type TradeObservation } from './fx-inference';
import { SHEET_NAMES, cellString } from './layout';
import { mapCashOperationRow } from './map-operation';
import { parseTradeComment } from './comment-grammar';
import { readClosedPositionTickers, readOpenPositionAggregates } from './positions';
import { reconcile } from './reconciliation';

async function loadWorkbook(file: RawFile) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(file.bytes) as never);
  return workbook;
}

/** Every real export opens each sheet with `Account number` in A1 and the sheet's own name in A2. */
function looksLikeXtbSheet(
  worksheet: ReturnType<InstanceType<typeof ExcelJS.Workbook>['getWorksheet']>,
  title: string,
): boolean {
  if (worksheet === undefined) return false;
  return cellString(worksheet, 1, 1) === 'Account number' && cellString(worksheet, 2, 1) === title;
}

async function sniff(file: RawFile): Promise<Confidence> {
  try {
    const workbook = await loadWorkbook(file);
    const hasAllThreeSheets =
      looksLikeXtbSheet(
        workbook.getWorksheet(SHEET_NAMES.cashOperations),
        SHEET_NAMES.cashOperations,
      ) &&
      looksLikeXtbSheet(
        workbook.getWorksheet(SHEET_NAMES.openPositions),
        SHEET_NAMES.openPositions,
      ) &&
      looksLikeXtbSheet(
        workbook.getWorksheet(SHEET_NAMES.closedPositions),
        SHEET_NAMES.closedPositions,
      );
    return hasAllThreeSheets ? 'certain' : 'none';
  } catch {
    return 'none'; // not a readable xlsx at all
  }
}

/**
 * The account's own cash currency isn't a column anywhere in the export — it
 * is implicit in every `Amount` on the `Cash Operations` sheet, the same way
 * a real XTB filename carries it (`EUR_2434935_...xlsx`) without it ever
 * appearing as a cell. The upload flow (its own ticket) is what actually
 * knows the target account's currency; until that wiring exists, this
 * resolves to the account the statement's own `Currency` column on
 * `Open Positions`' summary block reports, which is the one place the
 * currency genuinely appears as data.
 */
function accountCurrencyOf(workbook: Awaited<ReturnType<typeof loadWorkbook>>) {
  const openPositions = workbook.getWorksheet(SHEET_NAMES.openPositions);
  const code = openPositions === undefined ? null : cellString(openPositions, 5, 4);
  return currency(code ?? 'PLN');
}

async function parse(file: RawFile): Promise<ParsedStatement> {
  const workbook = await loadWorkbook(file);
  const cashOperations = workbook.getWorksheet(SHEET_NAMES.cashOperations);
  if (cashOperations === undefined) {
    throw new Error(
      `"${SHEET_NAMES.cashOperations}" sheet not found — sniff() should have refused this file`,
    );
  }

  const accountCurrency = accountCurrencyOf(workbook);
  const rawRows = readCashOperations(cashOperations);

  // Pass 1: recover every trade's own fill quantity/price from its comment,
  // to build the per-ticker FX ratio before mapping any single row.
  const observations: TradeObservation[] = [];
  for (const row of rawRows) {
    if (row.type !== 'Stock purchase' && row.type !== 'Stock sell') continue;
    if (row.ticker === null) continue;
    const comment = parseTradeComment(row.comment);
    if (comment === null) continue;
    observations.push({
      ticker: row.ticker,
      quantity: comment.quantity,
      price: comment.price,
      amount: row.amount.abs(),
    });
  }
  const fxRatioByTicker = inferFxRatios(observations);

  // Pass 2: map every row, now that the FX picture is known.
  const parsedRows = rawRows
    .map((row) => mapCashOperationRow(row, { accountCurrency, fxRatioByTicker }))
    .filter((row) => row !== null);

  const openPositions = workbook.getWorksheet(SHEET_NAMES.openPositions);
  const closedPositions = workbook.getWorksheet(SHEET_NAMES.closedPositions);
  const openVolumeByTicker =
    openPositions === undefined ? new Map() : readOpenPositionAggregates(openPositions);
  const closedPositionTickers =
    closedPositions === undefined ? new Set<string>() : readClosedPositionTickers(closedPositions);

  const { rows, statementWarnings } = reconcile(
    parsedRows,
    openVolumeByTicker,
    closedPositionTickers,
  );

  return { broker: xtbStatementParser.broker, rows, warnings: statementWarnings };
}

export const xtbStatementParser: StatementParser = {
  broker: 'xtb',
  sniff,
  parse,
};
