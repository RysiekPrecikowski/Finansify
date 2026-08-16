import type Decimal from 'decimal.js';
import type { Worksheet } from 'exceljs';

import {
  CLOSED_POSITIONS_DATA_START_ROW,
  CLOSED_POSITIONS_FOOTER_MARKER,
  OPEN_POSITIONS_DATA_START_ROW,
  closedPositionsColumn,
  cellDecimal,
  cellString,
  openPositionsColumn,
} from './layout';
import { normalizeXtbTicker } from './ticker-suffix';

/**
 * Only the aggregate (per-instrument) rows — a per-lot row (`Type` column
 * populated with `BUY`/`SELL`) is a breakdown of one of these and is skipped,
 * since reconciliation compares total open quantity, not individual lots.
 * Normalized the same way `instrumentOf` normalizes a `Cash Operations`
 * ticker — `reconcile()` joins the two sheets on this key, and XTB reports
 * the same instrument under the same raw ticker on every sheet, so the two
 * sides only agree if both go through `normalizeXtbTicker`.
 */
export function readOpenPositionAggregates(worksheet: Worksheet): ReadonlyMap<string, Decimal> {
  const volumeByTicker = new Map<string, Decimal>();

  for (let row = OPEN_POSITIONS_DATA_START_ROW; row <= worksheet.rowCount; row++) {
    const ticker = cellString(worksheet, row, openPositionsColumn.ticker);
    if (ticker === null) continue;

    const type = cellString(worksheet, row, openPositionsColumn.type);
    if (type !== null) continue; // a per-lot row, not an aggregate

    const volume = cellDecimal(worksheet, row, openPositionsColumn.volume);
    if (volume === null) continue;

    volumeByTicker.set(normalizeXtbTicker(ticker), volume);
  }

  return volumeByTicker;
}

/**
 * Every ticker that appears anywhere in `Closed Positions`, footer excluded —
 * normalized for the same reconciliation-join reason as
 * `readOpenPositionAggregates`.
 */
export function readClosedPositionTickers(worksheet: Worksheet): ReadonlySet<string> {
  const tickers = new Set<string>();

  for (let row = CLOSED_POSITIONS_DATA_START_ROW; row <= worksheet.rowCount; row++) {
    const instrument = cellString(worksheet, row, closedPositionsColumn.instrument);
    if (instrument === CLOSED_POSITIONS_FOOTER_MARKER) continue;

    const ticker = cellString(worksheet, row, closedPositionsColumn.ticker);
    if (ticker !== null) tickers.add(normalizeXtbTicker(ticker));
  }

  return tickers;
}
