import { type ScopedLedgerRepository } from '../ledger/ports';
import { type Transaction, type TransactionInput } from '../ledger/types';
import {
  importBatchIdSchema,
  type ImportRow,
  type ImportRowOutcome,
  type ScopedImportRepository,
} from '../imports';
import {
  CONFLICT_REASON,
  DELETED_REASON,
  transactionInputFromParsedRow,
} from './accept-import-row';
import { validateTransactionInputAgainstAccounts } from './record-transaction';
import { failure, success, type UseCaseResult } from './result';

/**
 * The bulk counterpart to `acceptImportRow` — accepts every acceptable
 * pending row in a batch with a fixed number of round trips instead of one
 * per row (`docs/decisions/` — this ticket's own rationale: a 326-row
 * statement was 326 × ~6 sequential HTTP round trips against Neon's HTTP
 * driver).
 *
 * Same branching as `acceptImportRow`, applied to the whole batch at once
 * rather than one row at a time:
 * - No existing transaction for a row's `external_id` → queued for one
 *   multi-row `createImportedTransactions` insert.
 * - An unedited, non-deleted match → `refreshImportedTransaction`, still one
 *   call per row (a re-import-of-an-already-accepted-row case, not the
 *   "first accept" path this ticket measured — batching it would need a
 *   second bulk-update shape for a path that is the exception, not the rule).
 * - A soft-deleted or hand-edited match → settles as `duplicate`, no write to
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
    const parsedId = importBatchIdSchema.safeParse(batchId);
    if (!parsedId.success) return failure([{ path: 'batchId', message: 'Not an import batch id' }]);

    const batch = await deps.imports.getBatch(parsedId.data);
    if (batch === null) return failure([{ path: 'batchId', message: 'Unknown import batch' }]);

    const rows = await deps.imports.rowsForBatch(parsedId.data);
    const acceptable = rows.filter(
      (row) =>
        row.status === 'pending' &&
        (row.parsed.instrument === null || row.resolvedInstrumentId !== null),
    );
    if (acceptable.length === 0) return success([]);

    const accounts = await deps.ledger.listAccounts();
    const validated: { row: ImportRow; input: TransactionInput }[] = [];
    for (const row of acceptable) {
      const raw = transactionInputFromParsedRow(
        row.parsed,
        row.resolvedInstrumentId,
        batch.accountId,
      );
      const result = validateTransactionInputAgainstAccounts(accounts, raw);
      if (result.ok) validated.push({ row, input: result.value });
    }
    if (validated.length === 0) return success([]);

    const existingByExternalId = await deps.ledger.findByExternalIds(
      batch.accountId,
      validated.map(({ row }) => row.parsed.externalId),
    );

    const outcomes: { id: ImportRow['id']; outcome: ImportRowOutcome }[] = [];
    const toCreate: { row: ImportRow; input: TransactionInput }[] = [];

    for (const { row, input } of validated) {
      const existing = existingByExternalId.get(row.parsed.externalId) ?? null;

      if (existing === null) {
        toCreate.push({ row, input });
        continue;
      }
      if (existing.deleted) {
        outcomes.push({
          id: row.id,
          outcome: { status: 'duplicate', transactionId: existing.id, reason: DELETED_REASON },
        });
        continue;
      }
      if (!existing.editedAfterImport) {
        const refreshed = await deps.ledger.refreshImportedTransaction(existing.id, input);
        outcomes.push({
          id: row.id,
          outcome: { status: 'accepted', transactionId: refreshed.id },
        });
        continue;
      }
      outcomes.push({
        id: row.id,
        outcome: { status: 'duplicate', transactionId: existing.id, reason: CONFLICT_REASON },
      });
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
    const updated = await deps.imports.recordRowOutcomes(parsedId.data, outcomes);
    return success(updated);
  };
}
