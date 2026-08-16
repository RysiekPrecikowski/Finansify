import { type AccountId, type InstrumentId, type TransactionId } from '../ledger/types';
import { type UserId } from '../ports/session';
import { type BrokerId, type ParsedRow } from '../ports/statement-parser';

import { type ImportBatch, type ImportBatchId, type ImportRow, type ImportRowId } from './types';

export interface CreateImportBatchInput {
  readonly accountId: AccountId;
  readonly broker: BrokerId;
  readonly blobKey: string;
}

/**
 * What resolving one distinct ticker in a batch means: every `import_rows`
 * whose `parsed.instrument` matches `(symbol, exchange)` gets `instrumentId`
 * as its `resolvedInstrumentId`, in one call — the bulk-confirm the
 * instrument-resolution UI needs, not a row-by-row loop.
 */
export interface InstrumentResolution {
  readonly symbol: string;
  readonly exchange: string | null;
  readonly instrumentId: InstrumentId;
}

/**
 * What settles a pending row — three possible endings. `accepted` covers both
 * a fresh transaction and an unedited existing one refreshed in place: either
 * way the row is now backed by a real transaction. `duplicate` is the
 * conflict case — an existing transaction for this `external_id` was
 * hand-edited since it was imported (`Transaction.editedAfterImport`), so
 * nothing was written to it. `rejected` is the reviewer's own choice to skip
 * the row — never written by `acceptImportRow` itself, only by
 * `rejectImportRow`. `reason` on both `duplicate` and `rejected` is what the
 * review UI shows for why.
 */
export type ImportRowOutcome =
  | { readonly status: 'accepted'; readonly transactionId: TransactionId }
  | {
      readonly status: 'duplicate';
      readonly transactionId: TransactionId;
      readonly reason: string;
    }
  | { readonly status: 'rejected'; readonly reason: string };

/**
 * Everything a signed-in user can do to their own import batches — same
 * shape and same reason as `ScopedLedgerRepository`: no method takes a
 * `userId`, so an unscoped query is not something a caller can express
 * (ADR 0009).
 */
export interface ScopedImportRepository {
  createBatch(input: CreateImportBatchInput): Promise<ImportBatch>;
  markBatchParsed(
    id: ImportBatchId,
    result: { readonly totalRows: number; readonly warnings: readonly string[] },
  ): Promise<ImportBatch>;
  markBatchFailed(id: ImportBatchId, reason: string): Promise<ImportBatch>;
  /** `rowIndex` is each row's position in `rows`, assigned here rather than by the caller. */
  createRows(batchId: ImportBatchId, rows: readonly ParsedRow[]): Promise<readonly ImportRow[]>;
  /** `null` if the batch doesn't exist or isn't owned by this user — never throws on a missing id. */
  getBatch(id: ImportBatchId): Promise<ImportBatch | null>;
  /** In `rowIndex` order. Throws if the batch isn't owned by this user, same as every other batch-id method here. */
  rowsForBatch(batchId: ImportBatchId): Promise<readonly ImportRow[]>;
  /** Returns every row touched, across all resolutions, in no particular order. */
  resolveInstruments(
    batchId: ImportBatchId,
    resolutions: readonly InstrumentResolution[],
  ): Promise<readonly ImportRow[]>;
  /** `null` if the row doesn't exist or its batch isn't owned by this user — never throws on a missing id. */
  getRow(id: ImportRowId): Promise<ImportRow | null>;
  /** Settles a pending row to `accepted` or `duplicate`. Throws if the row isn't owned by this user. */
  recordRowOutcome(id: ImportRowId, outcome: ImportRowOutcome): Promise<ImportRow>;
}

export interface ImportRepository {
  forUser(userId: UserId): ScopedImportRepository;
}
