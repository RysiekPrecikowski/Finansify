import type Decimal from 'decimal.js';
import { type Temporal } from '@finansify/core';
import type { Worksheet } from 'exceljs';

import {
  CLOSED_POSITIONS_DATA_START_ROW,
  CLOSED_POSITIONS_FOOTER_MARKER,
  closedPositionsColumn,
  cellDecimal,
  cellInstant,
  cellString,
  findOpenPositionsHeaderRow,
  openPositionsColumn,
} from './layout';
import { normalizeXtbTicker } from './ticker-suffix';

/**
 * Only the aggregate (per-instrument) rows — a per-lot row (`Type` column
 * populated with `BUY`/`SELL`) is a breakdown of one of these and is skipped
 * here (see `readOpenPositionLots` for what reads them), since reconciliation
 * compares total open quantity, not individual lots. Normalized the same way
 * `instrumentOf` normalizes a `Cash Operations` ticker — `reconcile()` joins
 * the two sheets on this key, and XTB reports the same instrument under the
 * same raw ticker on every sheet, so the two sides only agree if both go
 * through `normalizeXtbTicker`.
 */
export function readOpenPositionAggregates(worksheet: Worksheet): ReadonlyMap<string, Decimal> {
  const volumeByTicker = new Map<string, Decimal>();
  const headerRow = findOpenPositionsHeaderRow(worksheet);
  if (headerRow === null) return volumeByTicker;

  for (let row = headerRow + 1; row <= worksheet.rowCount; row++) {
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

/** One `Open Positions` per-lot row — a position XTB is still holding, opened at a known time and price. */
export interface OpenPositionLot {
  /** The position's own numeric id (`instrumentOrPosition` on a per-lot row) — stable across a re-export, so this is what a recovered row's `externalId` is built from. */
  readonly positionId: string;
  readonly ticker: string;
  readonly volume: Decimal;
  readonly openPrice: Decimal;
  readonly openTime: Temporal.Instant;
}

/**
 * Every per-lot `BUY`/`SELL` row, ticker normalized the same way
 * `readOpenPositionAggregates` is. `parser.ts` uses this as a last-resort
 * source for a ticker with an open position but zero `Cash Operations`
 * evidence at all — confirmed against a real account: a spin-off (Synektik
 * into Syn2bio) never appears on `Cash Operations`, but is recorded here as a
 * `BUY` lot at a near-zero open price. A row missing any of the fields a
 * recovered transaction needs is skipped rather than guessed at.
 *
 * The lot's own `BUY`/`SELL` marker is read but not carried into
 * `OpenPositionLot` — `mapOpenPositionLot` always recovers a positive
 * `transfer_in`, which would misrepresent a `SELL`-marked lot (a short
 * position) as a long one. No real export has shown a `SELL` open lot yet;
 * if one turns up, this needs a real decision, not a guess made now with no
 * evidence to check it against.
 */
export function readOpenPositionLots(worksheet: Worksheet): readonly OpenPositionLot[] {
  const headerRow = findOpenPositionsHeaderRow(worksheet);
  if (headerRow === null) return [];

  const lots: OpenPositionLot[] = [];
  for (let row = headerRow + 1; row <= worksheet.rowCount; row++) {
    const type = cellString(worksheet, row, openPositionsColumn.type);
    if (type !== 'BUY' && type !== 'SELL') continue; // an aggregate row, not a lot

    const ticker = cellString(worksheet, row, openPositionsColumn.ticker);
    const positionId = cellString(worksheet, row, openPositionsColumn.instrumentOrPosition);
    const volume = cellDecimal(worksheet, row, openPositionsColumn.volume);
    const openPrice = cellDecimal(worksheet, row, openPositionsColumn.openPrice);
    const openTime = cellInstant(worksheet, row, openPositionsColumn.openTime);
    if (
      ticker === null ||
      positionId === null ||
      volume === null ||
      openPrice === null ||
      openTime === null
    ) {
      continue;
    }

    lots.push({ positionId, ticker: normalizeXtbTicker(ticker), volume, openPrice, openTime });
  }

  return lots;
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
