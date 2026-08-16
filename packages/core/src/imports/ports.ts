import { type AccountId } from '../ledger/types';
import { type UserId } from '../ports/session';
import { type BrokerId, type ParsedRow } from '../ports/statement-parser';

import { type ImportBatch, type ImportBatchId, type ImportRow } from './types';

export interface CreateImportBatchInput {
  readonly accountId: AccountId;
  readonly broker: BrokerId;
  readonly blobKey: string;
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
}

export interface ImportRepository {
  forUser(userId: UserId): ScopedImportRepository;
}
