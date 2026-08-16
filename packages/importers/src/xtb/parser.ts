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
import { mapCashOperationRow, mapOpenPositionLot } from './map-operation';
import { parseTradeComment } from './comment-grammar';
import {
  readClosedPositionTickers,
  readOpenPositionAggregates,
  readOpenPositionLots,
} from './positions';
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
 * appearing as a cell. `Open Positions`' summary block is the one place it
 * genuinely appears as data, so that is what this reads.
 *
 * `null` when that cell is absent or is not an ISO 4217 code — never a
 * default. A guessed currency is the one wrong answer this parser must not
 * give: it does not produce a visibly odd number a reviewer would catch, it
 * relabels every correct amount in the statement, and the summary block is
 * exactly what an account with nothing currently open has no rows for. Rule 7
 * ("a missing price is an error, never an estimate") is the same principle
 * one field over; `parse()` turns this into a failed batch with a reason,
 * which `makeUploadStatement` already surfaces.
 */
function accountCurrencyOf(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
): ReturnType<typeof currency> | null {
  const openPositions = workbook.getWorksheet(SHEET_NAMES.openPositions);
  const code = openPositions === undefined ? null : cellString(openPositions, 5, 4);
  if (code === null) return null;
  try {
    return currency(code);
  } catch {
    return null;
  }
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
  if (accountCurrency === null) {
    throw new Error(
      `"${SHEET_NAMES.openPositions}" carries no readable account currency in its summary block — ` +
        'every amount in this statement would have to be guessed. Re-export the statement, or ' +
        'enter these transactions by hand.',
    );
  }

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

  // A ticker with an open lot but zero Cash Operations evidence at all (a
  // spin-off with no cash trace, confirmed against a real account) gets a
  // transaction recovered from Open Positions' own per-lot record instead of
  // only a warning — see `mapOpenPositionLot`.
  const tickersWithCashEvidence = new Set(
    parsedRows
      .filter((row) => (row.type === 'buy' || row.type === 'sell') && row.instrument !== null)
      .map((row) => row.instrument!.symbol),
  );
  const openPositionLots = openPositions === undefined ? [] : readOpenPositionLots(openPositions);
  const recoveredRows = openPositionLots
    .filter((lot) => !tickersWithCashEvidence.has(lot.ticker))
    .map((lot) => mapOpenPositionLot(lot, accountCurrency));

  const { rows, statementWarnings } = reconcile(
    [...parsedRows, ...recoveredRows],
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
