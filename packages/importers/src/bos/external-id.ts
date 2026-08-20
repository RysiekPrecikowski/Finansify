import { type BosRow } from './csv-rows';

/**
 * DM BOŚ's export carries no per-row id at all — no column names one, and
 * the "nr <reference>" embedded in a buy's `szczegóły` looked like a
 * candidate until checked against a real account: the same reference number
 * recurs across genuinely different trades months apart (different dates,
 * different quantities, different prices), so it is not unique and cannot be
 * the dedup key (rule 4/ADR 0004 needs a stable, unique `externalId`).
 *
 * What a real export does guarantee is deterministic row order for a fixed
 * date range and, empirically, duplicate full-content rows on genuine
 * duplicate events (two identical `Przelew do DM BOŚ` deposits, same date,
 * same amount, seen on one real account). So the id is the row's own full
 * content plus how many identical-content rows came before it in the file —
 * stable across a re-export of the same statement, and distinct for a
 * genuine duplicate event, without depending on BOŚ's own numbering at all.
 */
export function makeExternalIdFactory(): (row: BosRow) => string {
  const seen = new Map<string, number>();

  return (row: BosRow): string => {
    const key = [
      row.date.toString(),
      row.title,
      row.details,
      row.amount.toString(),
      row.currency,
    ].join(' ');

    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    return `bos:${key} ${occurrence}`;
  };
}
