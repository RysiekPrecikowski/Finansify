import { type AccountId, type InstrumentId } from '../ledger/types';
import { type UserId } from '../ports/session';
import { type BrokerId, type ParsedRow } from '../ports/statement-parser';

import { type ImportBatch, type ImportBatchId, type ImportRow } from './types';

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
}

export interface ImportRepository {
  forUser(userId: UserId): ScopedImportRepository;
}
