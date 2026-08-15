'use server';

import {
  makeDeleteTransaction,
  makeRecordTransaction,
  looksLikeSeriesCode,
  makeSearchInstruments,
  makeUpdateTransaction,
} from '@finansify/core';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { byField, submittedValues, type FormState } from '@/lib/form-state';
import { getDictionary } from '@/lib/i18n/server';
import { resolveInstrumentSelection } from '@/lib/instrument-selection';
import { transactionInputFrom } from '@/lib/transaction-form';
import { getInstrumentSearchProvider, getInstruments, scopedLedgerFor } from '@/server/container';

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
 * One row of what `<InstrumentCombobox>` shows and, on selection, submits back
 * as hidden fields — never a free-text symbol or exchange the user typed.
 * `existing` is already in our database (id alone is enough); `candidate` is
 * a provider search hit, identified by its own `symbol` and re-confirmed by
 * `selectInstrument` before anything is persisted (ADR 0014).
 */
export type InstrumentOption =
  | { readonly kind: 'existing'; readonly instrumentId: string; readonly label: string }
  | {
      readonly kind: 'candidate';
      readonly provider: string;
      readonly symbol: string;
      readonly name: string;
      // No kind, exchange or isin: the option exists to name a listing and to
      // label it. Anything descriptive would travel back as a form field the
      // client controls, and `instruments` is global — `confirm()` re-derives
      // all of it server-side instead. The exchange is already baked into
      // `label`.
      readonly label: string;
    }
  /**
   * A Polish retail treasury bond. No provider quotes these, so there is no
   * listing to confirm against and nothing to search — the series code is the
   * identity, and `selectBond` gates it by resolving the issue's terms
   * instead (ADR 0011). Offered whenever the query is *shaped* like a code;
   * whether the family exists is decided server-side, where a rejection can
   * explain itself.
   */
  | { readonly kind: 'bond'; readonly seriesCode: string; readonly label: string };

function labelOf(symbol: string, name: string, exchange: string | null): string {
  return exchange === null ? `${symbol} · ${name}` : `${symbol} · ${name} (${exchange})`;
}

function bondLabel(seriesCode: string): string {
  return `${seriesCode} · Obligacja skarbowa`;
}

/**
 * Local database first, Yahoo only as a fallback (`makeSearchInstruments`) —
 * behind `getCurrentUser()` because this can reach a third-party API on every
 * keystroke and an anonymous caller has no transaction to attach a result to
 * anyway. A provider failure degrades to "no results" rather than a thrown
 * error reaching the client typing in a text box.
 */
export async function searchInstrumentsAction(query: string): Promise<readonly InstrumentOption[]> {
  const user = await getCurrentUser();
  if (user === null) return [];

  try {
    const searchInstruments = makeSearchInstruments({
      instruments: getInstruments(),
      provider: getInstrumentSearchProvider(),
    });
    const result = await searchInstruments(query);

    const existing = result.existing.map<InstrumentOption>((instrument) => ({
      kind: 'existing',
      instrumentId: instrument.id,
      label: labelOf(instrument.symbol, instrument.name, instrument.exchange),
    }));

    // A series code is offered *alongside* whatever the provider found rather
    // than instead of it: a user typing `EDO0836` has no other way to reach a
    // bond, and Yahoo will happily return nothing for it. Suppressed once the
    // series is already an instrument, since the `existing` row for it is the
    // better answer — same id, and no resolver call on selection.
    const seriesCode = query.trim().toUpperCase();
    const alreadyHeld = result.existing.some((instrument) => instrument.symbol === seriesCode);
    const bond: readonly InstrumentOption[] =
      looksLikeSeriesCode(query) && !alreadyHeld
        ? [{ kind: 'bond', seriesCode, label: bondLabel(seriesCode) }]
        : [];

    if (existing.length > 0 || bond.length > 0) return [...bond, ...existing];

    return result.candidates.map<InstrumentOption>((candidate) => ({
      kind: 'candidate',
      provider: candidate.provider,
      symbol: candidate.symbol,
      name: candidate.name,
      label: labelOf(candidate.symbol, candidate.name, candidate.exchange),
    }));
  } catch (error) {
    console.error('Instrument search failed', error);
    return [];
  }
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

export async function createTransactionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await currentUserId();

  const instrument = await resolveInstrumentSelection(formData);
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

  const instrument = await resolveInstrumentSelection(formData);
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
