'use server';

import {
  importBatchIdSchema,
  importRowIdSchema,
  instrumentId,
  instrumentIdSchema,
  makeAcceptImportRow,
  makeRejectImportRow,
  makeUploadStatement,
  type ImportBatch,
  type InstrumentResolution,
} from '@finansify/core';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { byField, submittedValues, type FormState } from '@/lib/form-state';
import { getDictionary } from '@/lib/i18n/server';
import { resolveInstrumentSelection } from '@/lib/instrument-selection';
import { transactionInputFrom } from '@/lib/transaction-form';
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

function revalidateAfterAccept(batchId: string): void {
  revalidatePath(`/import/${batchId}/review`);
  revalidatePath('/transactions');
  revalidatePath('/portfolio');
}

/**
 * The one-click path for the common case — a row accepted exactly as the
 * broker exported it, no edits. `acceptImportRow` is given no overrides, so
 * it validates and dedups the parsed row as-is. A void action rather than
 * `useActionState`: there is no form to echo a failure back into here, so a
 * failure sends the reviewer to the row's own page (`edit-and-accept` does
 * have somewhere to show it).
 */
export async function acceptRowAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const rowIdResult = importRowIdSchema.safeParse(formData.get('rowId'));
  if (!rowIdResult.success) redirect('/import' as Route);
  const rowId = rowIdResult.data;

  const row = await scopedImportsFor(user.id).getRow(rowId);
  if (row === null) redirect('/import' as Route);

  const acceptImportRow = makeAcceptImportRow({
    imports: scopedImportsFor(user.id),
    ledger: scopedLedgerFor(user.id),
  });
  const result = await acceptImportRow(rowId);
  revalidateAfterAccept(row.batchId);

  if (!result.ok) redirect(`/import/${row.batchId}/review/${rowId}?error=1` as Route);
  redirect(`/import/${row.batchId}/review` as Route);
}

/**
 * Accepts every currently-pending row that doesn't still need instrument
 * resolution, one `acceptImportRow` call at a time — the bulk counterpart to
 * `acceptRowAction`, for the common case of a statement with no rows to edit.
 * A row that fails (a duplicate surfaced by an earlier row in the same
 * batch, say) simply stays `pending`: there is nowhere to show a per-row
 * error from a bulk action, and the reviewer already lands back on the list,
 * where an unaccepted row is visible and still reachable individually.
 */
export async function acceptAllPendingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const batchIdResult = importBatchIdSchema.safeParse(formData.get('batchId'));
  if (!batchIdResult.success) redirect('/import' as Route);
  const batchId = batchIdResult.data;

  const imports = scopedImportsFor(user.id);
  const rows = await imports.rowsForBatch(batchId);
  const acceptable = rows.filter(
    (row) =>
      row.status === 'pending' &&
      (row.parsed.instrument === null || row.resolvedInstrumentId !== null),
  );

  const acceptImportRow = makeAcceptImportRow({
    imports,
    ledger: scopedLedgerFor(user.id),
  });
  for (const row of acceptable) {
    await acceptImportRow(row.id);
  }

  revalidateAfterAccept(batchId);
  redirect(`/import/${batchId}/review` as Route);
}

/**
 * The edit-and-accept form's target — reuses `<TransactionForm>`,
 * `transactionInputFrom` and `resolveInstrumentSelection` exactly as
 * `createTransactionAction` does, so a reviewer edits a staged row with the
 * same fields and the same validation a hand-entered transaction gets. What
 * it submits becomes `acceptImportRow`'s `overrides` — `accountId` is never
 * taken from the form (the use case forces the batch's own account
 * regardless of what a submission carries).
 */
export async function acceptImportRowAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  // `<TransactionForm>` renders `values.id` as a hidden field named `id` (the
  // same field `updateTransactionAction` reads for a transaction id) —
  // here it carries the import row id instead, not a transaction id.
  const rowIdResult = importRowIdSchema.safeParse(formData.get('id'));
  if (!rowIdResult.success) redirect('/import' as Route);
  const rowId = rowIdResult.data;

  const row = await scopedImportsFor(user.id).getRow(rowId);
  if (row === null) redirect('/import' as Route);

  const instrument = await resolveInstrumentSelection(formData);
  if (!instrument.ok) {
    const values = submittedValues(formData);
    return { status: 'error', fieldErrors: byField(instrument.issues), values };
  }

  const acceptImportRow = makeAcceptImportRow({
    imports: scopedImportsFor(user.id),
    ledger: scopedLedgerFor(user.id),
  });
  const result = await acceptImportRow(rowId, {
    ...transactionInputFrom(formData),
    instrumentId: instrument.id,
  });

  if (!result.ok) {
    const values = submittedValues(formData);
    const dictionary = await getDictionary();
    return {
      status: 'error',
      fieldErrors: byField(result.issues),
      values,
      formError: dictionary.transactions.errors.invalid,
    };
  }

  revalidateAfterAccept(row.batchId);
  redirect(`/import/${row.batchId}/review` as Route);
}

/**
 * Settles a row to `rejected` without ever creating or touching a
 * transaction. `reason` is free text from the row page's own form; an empty
 * submission gets a default rather than a validation round trip — there is
 * nothing risky about a generic reason, and `rejectImportRow` still refuses
 * an empty string at its own boundary regardless of what this layer sends.
 */
export async function rejectRowAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const rowIdResult = importRowIdSchema.safeParse(formData.get('rowId'));
  if (!rowIdResult.success) redirect('/import' as Route);
  const rowId = rowIdResult.data;

  const row = await scopedImportsFor(user.id).getRow(rowId);
  if (row === null) redirect('/import' as Route);

  const rawReason = formData.get('reason');
  const reason =
    typeof rawReason === 'string' && rawReason.trim() !== ''
      ? rawReason.trim()
      : 'Skipped during review.';

  const rejectImportRow = makeRejectImportRow({ imports: scopedImportsFor(user.id) });
  await rejectImportRow(rowId, reason);

  revalidatePath(`/import/${row.batchId}/review`);
  redirect(`/import/${row.batchId}/review` as Route);
}
