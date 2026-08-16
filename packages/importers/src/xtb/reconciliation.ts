import Decimal from 'decimal.js';
import type { ParsedRow } from '@finansify/core';

export interface ReconciliationResult {
  readonly rows: readonly ParsedRow[];
  /**
   * Findings with no row to attach to — a ticker `Open Positions` reports as
   * held that has no buy/sell row anywhere in this statement at all (most
   * plausibly: the position predates the export's own date range). A
   * row-level warning has nowhere to live for these; this is the one class of
   * finding that is genuinely about the statement as a whole.
   */
  readonly statementWarnings: readonly string[];
}

/**
 * Cross-checks the cash-derived open quantity per ticker (buys minus sells,
 * from `Cash Operations`, plus any `transfer_in` `parser.ts` recovered from
 * `Open Positions` for a ticker `Cash Operations` had nothing for at all)
 * against `Open Positions`' own aggregate row and `Closed Positions`' record
 * of what has already been realized. This is what catches a stock split, a
 * spin-off, or a position with no counterpart anywhere in the export —
 * flagged, never auto-corrected and never blocking (ADR 0015).
 *
 * `transfer_in` counts here for the same reason `buy` does: this parser only
 * ever emits it for a recovered row, so including it cannot change how any
 * other row reconciles — it only lets a recovered row cross-check cleanly
 * against the same aggregate it was recovered from, instead of tripping the
 * "no counterpart" warning a moment after being recovered specifically to
 * resolve it.
 *
 * A mismatch attaches its warning to the *last* parsed row for that ticker
 * (by trade date) — the most recent entry a reviewer would naturally look at
 * first when following up on the ticker.
 */
export function reconcile(
  rows: readonly ParsedRow[],
  openVolumeByTicker: ReadonlyMap<string, Decimal>,
  closedPositionTickers: ReadonlySet<string>,
): ReconciliationResult {
  const netQuantityByTicker = new Map<string, Decimal>();
  const lastRowIndexByTicker = new Map<string, number>();

  rows.forEach((row, index) => {
    if (
      (row.type !== 'buy' && row.type !== 'sell' && row.type !== 'transfer_in') ||
      row.instrument === null
    ) {
      return;
    }
    const ticker = row.instrument.symbol;
    const delta = row.type === 'sell' ? row.quantity.negated() : row.quantity;
    netQuantityByTicker.set(
      ticker,
      (netQuantityByTicker.get(ticker) ?? new Decimal(0)).plus(delta),
    );
    lastRowIndexByTicker.set(ticker, index);
  });

  const warningsByRowIndex = new Map<number, string[]>();
  const addWarning = (ticker: string, message: string) => {
    const rowIndex = lastRowIndexByTicker.get(ticker);
    if (rowIndex === undefined) return;
    const existing = warningsByRowIndex.get(rowIndex);
    if (existing === undefined) warningsByRowIndex.set(rowIndex, [message]);
    else existing.push(message);
  };

  const tolerance = new Decimal('0.0001');

  for (const [ticker, cashNet] of netQuantityByTicker) {
    const openVolume = openVolumeByTicker.get(ticker);

    if (openVolume !== undefined) {
      if (cashNet.minus(openVolume).abs().greaterThan(tolerance)) {
        addWarning(
          ticker,
          `Reconciliation mismatch for ${ticker}: buys minus sells in this statement give ${cashNet.toFixed()} units, but the statement's own Open Positions reports ${openVolume.toFixed()} — possible stock split, spin-off, or correction. Review before accepting.`,
        );
      }
      continue;
    }

    if (!cashNet.isZero() && !closedPositionTickers.has(ticker)) {
      addWarning(
        ticker,
        `${ticker} has a nonzero cash-derived quantity (${cashNet.toFixed()}) but no counterpart in either Open Positions or Closed Positions anywhere in this statement — the position may be missing from the export entirely. Review before accepting.`,
      );
    }
  }

  const statementWarnings: string[] = [];
  for (const [ticker, openVolume] of openVolumeByTicker) {
    if (netQuantityByTicker.has(ticker)) continue; // already handled above
    statementWarnings.push(
      `${ticker} appears in Open Positions with ${openVolume.toFixed()} units, but this statement has no buy/sell row for it at all — most likely a spin-off with no cash trace (nothing to import from), or the position predates this export's date range. Review before accepting; a spin-off's cost basis needs entering by hand.`,
    );
  }

  const outputRows =
    warningsByRowIndex.size === 0
      ? rows
      : rows.map((row, index) => {
          const extra = warningsByRowIndex.get(index);
          return extra === undefined ? row : { ...row, warnings: [...row.warnings, ...extra] };
        });

  return { rows: outputRows, statementWarnings };
}
