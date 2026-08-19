import { type ScopedLedgerRepository } from '../ledger/ports';
import { type Transaction, type TransactionInput } from '../ledger/types';
import {
  importBatchIdSchema,
  type ImportBatch,
  type ImportRow,
  type ScopedImportRepository,
} from '../imports';

import { transactionInputFromParsedRow } from './accept-import-row';
import { validateTransactionInputAgainstAccounts } from './record-transaction';
import { failure, success, type UseCaseResult } from './result';

export interface PendingImportRow {
  readonly row: ImportRow;
  readonly input: TransactionInput;
  /** The reimport-dedup match for this row's `external_id`, or `null` for a brand-new one. */
  readonly existing: Transaction | null;
}

/**
 * Loads a batch's still-`pending`, resolution-complete rows, validates each
 * against the account list, and resolves the reimport-dedup lookup for all of
 * them in one bulk call — the shared setup `acceptImportRows` (which writes)
 * and `detectImportDuplicates` (which only classifies, for the review UI)
 * both need, so the two use cases can never drift into a different notion of
 * "what's pending and matched" from one another (rule 13: a second copy of
 * this loop is a refactor waiting to happen, not something to write twice).
 *
 * A row that fails validation, or was never acceptable to begin with (still
 * needs instrument resolution, or isn't `pending`), is simply absent from
 * `pending` — exactly as `acceptImportRows` already left such a row out.
 */
export async function loadPendingImportRows(
  deps: { imports: ScopedImportRepository; ledger: ScopedLedgerRepository },
  batchId: unknown,
): Promise<UseCaseResult<{ batch: ImportBatch; pending: readonly PendingImportRow[] }>> {
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
  if (acceptable.length === 0) return success({ batch, pending: [] });

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
  if (validated.length === 0) return success({ batch, pending: [] });

  const existingByExternalId = await deps.ledger.findByExternalIds(
    batch.accountId,
    validated.map(({ row }) => row.parsed.externalId),
  );

  const pending = validated.map(({ row, input }) => ({
    row,
    input,
    existing: existingByExternalId.get(row.parsed.externalId) ?? null,
  }));
  return success({ batch, pending });
}
