'use server';

import { makeUploadStatement, type ImportBatch } from '@finansify/core';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import {
  clock,
  getFileStore,
  getStatementParsers,
  scopedImportsFor,
  scopedLedgerFor,
} from '@/server/container';

/** JSON-safe copy for a client component — `uploadedAt` is a `Temporal.Instant`. */
export interface UploadedBatch {
  readonly id: string;
  readonly accountId: string;
  readonly broker: string;
  readonly status: string;
  readonly failureReason: string | null;
  readonly totalRows: number;
  readonly warnings: readonly string[];
}

export type UploadStatementState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'done'; readonly batch: UploadedBatch };

function serializeBatch(batch: ImportBatch): UploadedBatch {
  return {
    id: batch.id,
    accountId: batch.accountId,
    broker: batch.broker,
    status: batch.status,
    failureReason: batch.failureReason,
    totalRows: batch.totalRows,
    warnings: batch.warnings,
  };
}

/**
 * Upload → sniff → store → parse → stage (`makeUploadStatement`). This is as
 * far as Phase 4 currently reaches: the resulting `import_rows` have no
 * resolved instrument, no dedup check, and no accepted `transactions` yet —
 * that is instrument resolution, the import use case, and the review UI,
 * each its own ticket. This screen exists to prove the pipeline up to here
 * works end to end, not to be the final review experience.
 */
export async function uploadStatementAction(
  _previous: UploadStatementState,
  formData: FormData,
): Promise<UploadStatementState> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a file to upload.' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadStatement = makeUploadStatement({
    ledger: scopedLedgerFor(user.id),
    imports: scopedImportsFor(user.id),
    fileStore: getFileStore(),
    parsers: getStatementParsers(),
    clock,
  });

  const result = await uploadStatement({
    accountId: formData.get('accountId'),
    file: { filename: file.name, bytes },
  });

  if (!result.ok) {
    return { status: 'error', message: result.issues.map((issue) => issue.message).join(' ') };
  }

  return { status: 'done', batch: serializeBatch(result.value) };
}
