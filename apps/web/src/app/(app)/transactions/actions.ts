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
import {
  getCatalystBondLookup,
  getInstrumentSearchProviders,
  getInstruments,
  scopedLedgerFor,
} from '@/server/container';

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
  | { readonly kind: 'bond'; readonly seriesCode: string; readonly label: string }
  /**
   * A Catalyst-listed corporate bond. Also bypasses `selectInstrument`, for a
   * different reason than a treasury bond: it *is* quoted, but `gpw`'s price
   * lookups are keyed by ISIN while the ticker is what search and the terms
   * resolver answer to — two identifiers `confirm()`'s one-`symbol` contract
   * cannot carry (ADR 0023, Stage 6). `makeSelectCatalystBond` looks the
   * ticker up again server-side and writes both.
   */
  | { readonly kind: 'catalyst_bond'; readonly ticker: string; readonly label: string };

function labelOf(symbol: string, name: string, exchange: string | null): string {
  return exchange === null ? `${symbol} · ${name}` : `${symbol} · ${name} (${exchange})`;
}

const MIN_QUERY_LENGTH = 2;

/**
 * Every instrument search is one of four independent sources, each queried
 * and rendered on its own timer — nothing here assumes which one answers
 * first. A slow one (in practice, `gpwcatalyst.pl`'s uncached listing page —
 * but nothing below hard-codes that) must never hold up a fast one's
 * results, so the client fires all four in parallel and merges whichever
 * has answered so far; each is independently correct in isolation (a local
 * DB hit already answers the question on its own, and `searchYahooAction`/
 * `searchBankierAction` each redo that same cheap local check themselves
 * before asking their provider — see below), so there is nothing to
 * coordinate between them and no ordering to get wrong.
 */

/**
 * The local database — always the fastest possible answer, but not treated
 * specially for that reason; it is simply one of the four sources. A hit
 * here is also *the* answer: `searchYahooAction`/`searchBankierAction` each
 * redo this same check before asking their provider, so their own results
 * come back empty whenever this one is non-empty — no shared "suppress the
 * others" flag needed, each source is self-consistent.
 */
export async function searchExistingAction(query: string): Promise<readonly InstrumentOption[]> {
  const user = await getCurrentUser();
  if (user === null) return [];
  if (query.trim().length < MIN_QUERY_LENGTH) return [];

  try {
    const found = await getInstruments().search(query);
    const existing = found.map<InstrumentOption>((instrument) => ({
      kind: 'existing',
      instrumentId: instrument.id,
      label: labelOf(instrument.symbol, instrument.name, instrument.exchange),
    }));

    // A series code is offered *alongside* an existing hit rather than
    // instead of it: a user typing `EDO0836` has no other way to reach a
    // bond. Suppressed once the series is already an instrument, since the
    // `existing` row for it is the better answer — same id, no resolver call.
    const seriesCode = query.trim().toUpperCase();
    const dictionary = await getDictionary();
    const alreadyHeld = found.some((instrument) => instrument.symbol === seriesCode);
    const bond: readonly InstrumentOption[] =
      looksLikeSeriesCode(query) && !alreadyHeld
        ? [
            {
              kind: 'bond',
              seriesCode,
              label: `${seriesCode} · ${dictionary.instruments.bondName}`,
            },
          ]
        : [];

    return [...bond, ...existing];
  } catch (error) {
    console.error('Instrument search failed', error);
    return [];
  }
}

async function searchViaProvider(
  query: string,
  providerName: string,
): Promise<readonly InstrumentOption[]> {
  const user = await getCurrentUser();
  if (user === null) return [];

  const provider = getInstrumentSearchProviders().find((p) => p.name === providerName);
  if (provider === undefined) return [];

  try {
    const searchInstruments = makeSearchInstruments({ instruments: getInstruments(), provider });
    const result = await searchInstruments(query);
    // `result.existing` is discarded here — `searchExistingAction` owns that
    // answer. This call's own local check exists only to decide whether
    // asking `provider` was worth doing at all (`makeSearchInstruments`'s own
    // "local first" rule), which is also what makes this source self-
    // consistent without coordinating with the others.
    return result.candidates.map<InstrumentOption>((candidate) => ({
      kind: 'candidate',
      provider: candidate.provider,
      symbol: candidate.symbol,
      name: candidate.name,
      label: labelOf(candidate.symbol, candidate.name, candidate.exchange),
    }));
  } catch (error) {
    console.error(`Instrument search via ${providerName} failed`, error);
    return [];
  }
}

export async function searchYahooAction(query: string): Promise<readonly InstrumentOption[]> {
  return searchViaProvider(query, 'yahoo');
}

export async function searchBankierAction(query: string): Promise<readonly InstrumentOption[]> {
  return searchViaProvider(query, 'bankier');
}

/**
 * Catalyst bonds — the fourth independent source. Checks "already held"
 * itself, with its own (local, cheap) DB query, rather than depending on
 * `searchExistingAction`'s result: the two calls race, and this one must
 * stay correct regardless of which finishes first.
 */
export async function searchCatalystBondsAction(
  query: string,
): Promise<readonly InstrumentOption[]> {
  const user = await getCurrentUser();
  if (user === null) return [];

  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  try {
    const [existing, catalystBonds] = await Promise.all([
      getInstruments().search(trimmed),
      getCatalystBondLookup().search(trimmed),
    ]);

    return catalystBonds
      .filter((candidate) => !existing.some((instrument) => instrument.symbol === candidate.ticker))
      .map<InstrumentOption>((candidate) => ({
        kind: 'catalyst_bond',
        ticker: candidate.ticker,
        label: `${candidate.ticker} · ${candidate.issuerName}`,
      }));
  } catch (error) {
    console.error('Catalyst bond search failed', error);
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
