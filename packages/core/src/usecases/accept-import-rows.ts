import { type ScopedLedgerRepository } from '../ledger/ports';
import { type Transaction, type TransactionId, type TransactionInput } from '../ledger/types';
import { type ImportRow, type ImportRowOutcome, type ScopedImportRepository } from '../imports';
import { loadPendingImportRows } from './pending-import-rows';
import { classifyReimport } from './reimport-classification';
import { success, type UseCaseResult } from './result';

/**
 * The bulk counterpart to `acceptImportRow` — accepts every acceptable
 * pending row in a batch with a fixed number of round trips instead of one
 * per row (`docs/decisions/` — this ticket's own rationale: a 326-row
 * statement was 326 × ~6 sequential HTTP round trips against Neon's HTTP
 * driver).
 *
 * Every row is classified by `classifyReimport` (same rule `acceptImportRow`
 * describes in its own doc comment) and grouped so each outcome is reached
 * with a fixed number of round trips, not one per row:
 * - `new` → queued for one multi-row `createImportedTransactions` insert.
 * - `unchanged` → an unedited, non-deleted match whose data already restates
 *   what is on file. Settled `accepted` against the existing transaction with
 *   **no write at all** — a re-import of an unchanged statement hits this
 *   for nearly every row, which is the whole reason this is checked rather
 *   than refreshed unconditionally.
 * - `changed` → an unedited, non-deleted match whose data actually differs.
 *   Queued for one multi-row `refreshImportedTransactions` update.
 * - `conflict` / `deleted` → settles as `duplicate`, no write to
 *   `transactions` at all.
 *
 * Never taken through `acceptImportRow`'s `overrides` path — this is
 * specifically the one-click "accept everything as parsed" case; a row that
 * needs an edit goes through the single-row edit-and-accept form instead.
 *
 * A row that fails validation (or was never acceptable to begin with — still
 * needs instrument resolution, or isn't `pending`) is simply left out: it
 * stays `pending`, exactly as the row-by-row loop this replaces left it,
 * since there is no per-row error surface on the bulk-accept screen.
 */
export function makeAcceptImportRows(deps: {
  imports: ScopedImportRepository;
  ledger: ScopedLedgerRepository;
}) {
  return async function acceptImportRows(
    batchId: unknown,
  ): Promise<UseCaseResult<readonly ImportRow[]>> {
    const loaded = await loadPendingImportRows(deps, batchId);
    if (!loaded.ok) return loaded;
    const { batch, pending } = loaded.value;
    if (pending.length === 0) return success([]);

    const outcomes: { id: ImportRow['id']; outcome: ImportRowOutcome }[] = [];
    const toCreate: { row: ImportRow; input: TransactionInput }[] = [];
    const toRefresh: { row: ImportRow; input: TransactionInput; existingId: TransactionId }[] = [];

    for (const { row, input, existing } of pending) {
      const classification = classifyReimport(existing, input);

      switch (classification.kind) {
        case 'new':
          toCreate.push({ row, input });
          break;
        case 'unchanged':
          outcomes.push({
            id: row.id,
            outcome: { status: 'accepted', transactionId: classification.existingId },
          });
          break;
        case 'changed':
          toRefresh.push({ row, input, existingId: classification.existingId });
          break;
        case 'conflict':
        case 'deleted':
          outcomes.push({
            id: row.id,
            outcome: {
              status: 'duplicate',
              transactionId: classification.existingId,
              reason: classification.reason,
            },
          });
          break;
      }
    }

    if (toRefresh.length > 0) {
      const refreshed = await deps.ledger.refreshImportedTransactions(
        toRefresh.map(({ existingId, input }) => ({ id: existingId, input })),
      );
      const refreshedById = new Map(refreshed.map((transaction) => [transaction.id, transaction]));
      for (const { row, existingId } of toRefresh) {
        const transaction = refreshedById.get(existingId);
        if (transaction === undefined) continue;
        outcomes.push({
          id: row.id,
          outcome: { status: 'accepted', transactionId: transaction.id },
        });
      }
    }

    if (toCreate.length > 0) {
      const created = await deps.ledger.createImportedTransactions(
        toCreate.map(({ row, input }) => ({
          input,
          origin: { externalId: row.parsed.externalId, importBatchId: batch.id },
        })),
      );
      const createdByExternalId = new Map<string, Transaction>();
      for (const transaction of created) {
        if (transaction.externalId !== null)
          createdByExternalId.set(transaction.externalId, transaction);
      }
      for (const { row } of toCreate) {
        const transaction = createdByExternalId.get(row.parsed.externalId);
        if (transaction === undefined) continue;
        outcomes.push({
          id: row.id,
          outcome: { status: 'accepted', transactionId: transaction.id },
        });
      }
    }

    if (outcomes.length === 0) return success([]);
    const updated = await deps.imports.recordRowOutcomes(batch.id, outcomes);
    return success(updated);
  };
}
