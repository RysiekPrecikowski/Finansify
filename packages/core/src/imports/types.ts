import { z } from 'zod';

import { type AccountId } from '../ledger/types';
import { type ImportBatchStatus, type ImportRowStatus } from '../ledger/vocabulary';
import { type BrokerId, type ParsedRow } from '../ports/statement-parser';
import { type TransactionId } from '../ledger/types';
import { type Temporal } from '../time';

export const importBatchIdSchema = z.string().uuid().brand<'ImportBatchId'>();
export type ImportBatchId = z.infer<typeof importBatchIdSchema>;
export const importBatchId = (value: string): ImportBatchId => importBatchIdSchema.parse(value);

export const importRowIdSchema = z.string().uuid().brand<'ImportRowId'>();
export type ImportRowId = z.infer<typeof importRowIdSchema>;
export const importRowId = (value: string): ImportRowId => importRowIdSchema.parse(value);

/**
 * One uploaded statement. `status` tracks only whether `parse()` itself
 * succeeded — never review progress, which is always a live query over this
 * batch's rows (see `ImportBatchStatus`'s own doc comment in
 * `ledger/vocabulary.ts`, where it lives alongside `transactionTypes` rather
 * than a separate `imports/vocabulary.ts` — moving it now would touch a file
 * an already-open, unmerged PR also edits, for no functional gain).
 */
export interface ImportBatch {
  readonly id: ImportBatchId;
  readonly accountId: AccountId;
  readonly broker: BrokerId;
  readonly blobKey: string;
  readonly status: ImportBatchStatus;
  readonly failureReason: string | null;
  readonly totalRows: number;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  readonly duplicateRows: number;
  /** From `ParsedStatement.warnings` — a finding with no single row to attach to. */
  readonly warnings: readonly string[];
  readonly uploadedAt: Temporal.Instant;
}

/**
 * One statement line, staged for review. `parsed` is the real `ParsedRow`
 * `packages/importers` produced — `ScopedImportRepository` is what owns
 * turning that into and out of `import_rows.parsed`'s `JSONB`, so every
 * caller on this side of the port works with the same value objects
 * (`Money`, `Decimal`, `Temporal.PlainDate`) the rest of `core` does, never a
 * loosely-typed JSON blob.
 */
export interface ImportRow {
  readonly id: ImportRowId;
  readonly batchId: ImportBatchId;
  readonly rowIndex: number;
  readonly parsed: ParsedRow;
  readonly status: ImportRowStatus;
  readonly transactionId: TransactionId | null;
  readonly rejectionReason: string | null;
}
