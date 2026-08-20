import { type InstrumentId } from '../ledger/types';

import { type ImportRow } from './types';

/**
 * Every `import_rows` line that shares one `(symbol, exchange)` collapsed to
 * one entry — an XTB statement repeats the same handful of tickers across
 * hundreds of rows, and the resolution UI confirms a ticker once, not per
 * row. Rows whose `parsed.instrument` is `null` (pure cash lines) contribute
 * to no group; there is nothing to resolve for them.
 */
export interface ImportInstrumentCandidateGroup {
  readonly symbol: string;
  readonly exchange: string | null;
  /** The importer's own label for the ticker, if it had one — display only. */
  readonly name: string | null;
  /** The broker's ISIN for this ticker, if it gave one — `match-import-instruments.ts`'s preferred auto-match key. */
  readonly isin: string | null;
  readonly rowCount: number;
  /**
   * Set when every row in the group already carries the same
   * `resolvedInstrumentId` — `resolveInstruments` writes it to a whole group
   * at once, so a group is never partially resolved.
   */
  readonly resolvedInstrumentId: InstrumentId | null;
}

function groupKey(symbol: string, exchange: string | null): string {
  return `${symbol} ${exchange ?? ''}`;
}

export function groupInstrumentCandidates(
  rows: readonly ImportRow[],
): readonly ImportInstrumentCandidateGroup[] {
  const groups = new Map<
    string,
    {
      symbol: string;
      exchange: string | null;
      name: string | null;
      isin: string | null;
      rowCount: number;
      resolvedInstrumentId: InstrumentId | null;
    }
  >();

  for (const row of rows) {
    const candidate = row.parsed.instrument;
    if (candidate === null) continue;

    const key = groupKey(candidate.symbol, candidate.exchange);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        symbol: candidate.symbol,
        exchange: candidate.exchange,
        name: candidate.name,
        isin: candidate.isin ?? null,
        rowCount: 1,
        resolvedInstrumentId: row.resolvedInstrumentId,
      });
    } else {
      existing.rowCount += 1;
    }
  }

  return [...groups.values()];
}
