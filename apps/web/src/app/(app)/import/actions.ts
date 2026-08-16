'use server';

import {
  importBatchIdSchema,
  instrumentId,
  instrumentIdSchema,
  makeUploadStatement,
  type ImportBatch,
  type InstrumentResolution,
} from '@finansify/core';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { resolveInstrumentSelection } from '@/lib/instrument-selection';
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

/**
 * One checked box from the bulk-confirm form, decoded from its own `value` —
 * not three index-aligned arrays (`symbols[]`/`exchanges[]`/`instrumentIds[]`):
 * an unchecked box submits nothing at all, which would desync any index-based
 * scheme the moment one group is left unchecked. `null` on anything
 * malformed — a hand-crafted request gets silently dropped rather than
 * resolving an unintended row, the same posture `deserializeParsedRow` takes
 * toward its own JSON.
 */
function parseResolution(raw: string): InstrumentResolution | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { symbol, exchange, instrumentId: rawInstrumentId } = parsed as Record<string, unknown>;
  if (typeof symbol !== 'string' || symbol === '') return null;
  if (exchange !== null && typeof exchange !== 'string') return null;

  const idResult = instrumentIdSchema.safeParse(rawInstrumentId);
  if (!idResult.success) return null;

  return { symbol, exchange, instrumentId: idResult.data };
}

/**
 * Bulk-confirms every checked auto-match in one call — the common case, since
 * a statement repeats the same handful of tickers across hundreds of rows.
 * Nothing here calls `selectInstrument`: the suggested instrument already
 * exists in our own database (`makeMatchImportInstruments` only ever
 * suggests an exact local hit), so there is nothing left to `findOrCreate`.
 */
export async function confirmAutoMatchesAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const batchIdResult = importBatchIdSchema.safeParse(formData.get('batchId'));
  if (!batchIdResult.success) redirect('/import' as Route);
  const batchId = batchIdResult.data;

  const resolutions = formData
    .getAll('resolutions')
    .filter((value): value is string => typeof value === 'string')
    .map(parseResolution)
    .filter((resolution): resolution is InstrumentResolution => resolution !== null);

  if (resolutions.length > 0) {
    await scopedImportsFor(user.id).resolveInstruments(batchId, resolutions);
  }

  revalidatePath(`/import/${batchId}`);
  redirect(`/import/${batchId}` as Route);
}

/**
 * The fallback for a ticker auto-match couldn't guess — one `<InstrumentCombobox>`
 * per group, each its own `<form>`, so this only ever resolves the one ticker
 * its hidden `symbol`/`exchange` fields name. Reuses `resolveInstrumentSelection`
 * (`@/lib/instrument-selection`), the same `findOrCreate` round trip
 * `/transactions/new` uses — a provider hit becomes a real, priceable
 * `Instrument` here exactly as it would there (rule 13).
 */
export async function confirmManualMatchAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const batchIdResult = importBatchIdSchema.safeParse(formData.get('batchId'));
  if (!batchIdResult.success) redirect('/import' as Route);
  const batchId = batchIdResult.data;

  const symbol = formData.get('symbol');
  if (typeof symbol !== 'string' || symbol === '') redirect(`/import/${batchId}` as Route);

  const exchangeRaw = formData.get('exchange');
  const exchange = typeof exchangeRaw === 'string' && exchangeRaw !== '' ? exchangeRaw : null;

  const selection = await resolveInstrumentSelection(formData);
  if (!selection.ok || selection.id === null) {
    // Nothing was picked, or `selectInstrument` refused the candidate — there
    // is no field on this page to render the error against (no client form
    // state, unlike the transaction form), so the ticker just stays
    // unresolved and the user tries again from the review screen.
    redirect(`/import/${batchId}` as Route);
  }

  await scopedImportsFor(user.id).resolveInstruments(batchId, [
    { symbol, exchange, instrumentId: instrumentId(selection.id) },
  ]);

  revalidatePath(`/import/${batchId}`);
  redirect(`/import/${batchId}` as Route);
}
