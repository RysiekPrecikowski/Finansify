'use server';

import {
  makeDeleteTransaction,
  makeRecordTransaction,
  makeResolveInstrument,
  makeUpdateTransaction,
  type FieldIssue,
} from '@finansify/core';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { byField, submittedValues, type FormState } from '@/lib/form-state';
import { getDictionary } from '@/lib/i18n/server';
import { transactionInputFrom } from '@/lib/transaction-form';
import { getInstruments, scopedLedgerFor } from '@/server/container';

/**
 * The identity is read from the session inside every action, on every submit —
 * never from a hidden field and never from a client argument. A Server Action is
 * a POST endpoint anyone who can send the request can reach, and ADR 0009
 * declined row-level security on the strength of `scopedLedgerFor` (rule 4).
 *
 * The transaction id below *is* taken from the form, and that is safe for a
 * different reason: it is not an identity claim. `updateTransaction` and
 * `softDeleteTransaction` resolve it through the caller's own scoped repository,
 * so an id belonging to somebody else is not found and throws rather than being
 * written.
 */
async function currentUserId() {
  const user = await getCurrentUser();
  // Not a typedRoutes literal: `/sign-in` is served by the catch-all
  // `/sign-in/[[...sign-in]]`, which the generated route type does not include.
  if (user === null) redirect('/sign-in' as Route);
  return user.id;
}

/**
 * `instrumentInputSchema` reports issues on `symbol`, `name`, `kind` and
 * `currency`; the form names those inputs `instrumentSymbol` and friends so they
 * cannot collide with the transaction's own `currency`. Re-pointing the paths
 * here is what makes a message land under the field that caused it.
 */
function onInstrumentFields(issues: readonly FieldIssue[]): readonly FieldIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: `instrument${issue.path.charAt(0).toUpperCase()}${issue.path.slice(1)}`,
  }));
}

/**
 * `values` echoes the submission back so the rejected form re-renders with what
 * the user typed. React resets an uncontrolled input when the action
 * re-renders, and this form has fourteen of them — one bad rate would otherwise
 * clear the whole row.
 */
async function invalid(
  fieldErrors: FormState['fieldErrors'],
  formData: FormData,
): Promise<FormState> {
  const values = submittedValues(formData);
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

  // `byField` drops issues that belong to no field. If that leaves nothing, the
  // form would render as though the submit had silently done nothing.
  const dictionary = await getDictionary();
  return {
    status: 'error',
    fieldErrors,
    values,
    formError: dictionary.transactions.errors.invalid,
  };
}

/**
 * Resolving a new instrument is two ports and no domain rule, which is why it
 * happens here rather than inside `recordTransaction`: instruments are global
 * (ADR 0010) and the ledger is user-scoped, so one use case cannot own both.
 */
async function resolveInstrumentId(
  formData: FormData,
): Promise<{ ok: true; id: string | null } | { ok: false; issues: readonly FieldIssue[] }> {
  if (formData.get('instrumentMode') !== 'new') {
    const selected = formData.get('instrumentId');
    return { ok: true, id: typeof selected === 'string' && selected !== '' ? selected : null };
  }

  const resolved = await makeResolveInstrument({ instruments: getInstruments() })({
    symbol: formData.get('instrumentSymbol'),
    name: formData.get('instrumentName'),
    kind: formData.get('instrumentKind'),
    currency: formData.get('instrumentCurrency'),
  });

  return resolved.ok
    ? { ok: true, id: resolved.value.id }
    : { ok: false, issues: onInstrumentFields(resolved.issues) };
}

export async function createTransactionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await currentUserId();

  const instrument = await resolveInstrumentId(formData);
  if (!instrument.ok) return invalid(byField(instrument.issues), formData);

  const recordTransaction = makeRecordTransaction({ ledger: scopedLedgerFor(userId) });
  const result = await recordTransaction({
    ...transactionInputFrom(formData),
    instrumentId: instrument.id,
  });

  if (!result.ok) return invalid(byField(result.issues), formData);

  revalidatePath('/transactions');
  revalidatePath('/portfolio');
  // Outside any try/catch on purpose: `redirect()` signals by throwing.
  redirect('/transactions');
}

export async function updateTransactionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await currentUserId();

  const instrument = await resolveInstrumentId(formData);
  if (!instrument.ok) return invalid(byField(instrument.issues), formData);

  const updateTransaction = makeUpdateTransaction({ ledger: scopedLedgerFor(userId) });
  const result = await updateTransaction(formData.get('id'), {
    ...transactionInputFrom(formData),
    instrumentId: instrument.id,
  });

  if (!result.ok) return invalid(byField(result.issues), formData);

  revalidatePath('/transactions');
  revalidatePath('/portfolio');
  redirect('/transactions');
}

/**
 * A `<form>` submit rather than a link: a GET that deletes is one prefetch away
 * from deleting a row nobody asked to delete. Soft delete only (ADR 0004).
 */
export async function deleteTransactionAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();

  const deleteTransaction = makeDeleteTransaction({ ledger: scopedLedgerFor(userId) });
  await deleteTransaction(formData.get('id'));

  revalidatePath('/transactions');
  revalidatePath('/portfolio');
  redirect('/transactions');
}
