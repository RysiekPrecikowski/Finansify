'use server';

import { makeOpenAccount } from '@finansify/core';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { byField, submittedValues, type FormState } from '@/lib/form-state';
import { getDictionary } from '@/lib/i18n/server';
import { scopedLedgerFor } from '@/server/container';

/**
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * request, so the identity is taken from the session **here**, every time — never
 * from a hidden field and never from a client argument. ADR 0009 declined
 * row-level security on the strength of `scopedLedgerFor`, which means this is
 * the only thing standing between one user and another's rows (rule 4).
 *
 * Validation is `openAccount`'s, not this file's: a route that parses its own
 * domain input is a route that will eventually parse it differently from the
 * use case.
 */
export async function createAccountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  // Not a typedRoutes literal: `/sign-in` is served by the catch-all
  // `/sign-in/[[...sign-in]]`, which the generated route type does not include.
  if (user === null) redirect('/sign-in' as Route);

  const openAccount = makeOpenAccount({ ledger: scopedLedgerFor(user.id) });

  const result = await openAccount({
    name: formData.get('name'),
    broker: formData.get('broker'),
    wrapper: formData.get('wrapper'),
    currency: formData.get('currency'),
    openedAt: formData.get('openedAt'),
  });

  if (!result.ok) {
    const fieldErrors = byField(result.issues);
    // Echoed back so the rejected form re-renders with what was typed: React
    // resets an uncontrolled input when the action re-renders, and one bad
    // field would otherwise empty every good one.
    const values = submittedValues(formData);
    // `byField` drops issues that belong to no field. If that leaves nothing,
    // the form would render as though the submit had silently done nothing, so
    // the failure gets said out loud instead.
    if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

    const dictionary = await getDictionary();
    return {
      status: 'error',
      fieldErrors,
      values,
      formError: dictionary.accounts.errors.invalid,
    };
  }

  revalidatePath('/accounts');
  // Outside any try/catch on purpose: `redirect()` signals by throwing, so a
  // catch around it swallows the navigation and reports it as a failure.
  redirect('/accounts');
}
