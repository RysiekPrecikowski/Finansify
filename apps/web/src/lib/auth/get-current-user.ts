import { auth, currentUser } from '@clerk/nextjs/server';
import { findOrCreateUser, findUserByIdentity } from '@finansify/db';
import { userId, type AuthenticatedUser } from '@finansify/core';
import { cache } from 'react';

import { getDb } from '@/server/container';

/**
 * The one function everything outside this directory calls — never Clerk's
 * `auth()` or `currentUser()` directly (ADR 0009, rule 2).
 *
 * Memoized with React's `cache()`: the `(app)` layout calls this once per
 * request already, and Phase 1 pages will call it again to scope their own
 * queries — without memoization each call repeats the `users` lookup.
 *
 * The local `users` row is provisioned here, lazily, on a cache miss, rather
 * than by a signup webhook: every call pays the same lookup either way, so this
 * adds no cost over the webhook path, and there is exactly one creation path
 * instead of two. The identity lookup runs first so a returning user never
 * costs a Clerk Backend API call — `currentUser()` only runs when a row
 * actually needs to be created, since that's the only time Clerk's copy of the
 * email is needed over our own.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const { userId: subject } = await auth();
  if (subject === null) return null;

  const identity = { authProvider: 'clerk' as const, authSubject: subject };
  const db = getDb();

  const existing = await findUserByIdentity(db, identity);
  if (existing !== undefined) return { id: userId(existing.id), email: existing.email };

  const email = (await currentUser())?.primaryEmailAddress?.emailAddress;
  if (email === undefined) {
    // A session Clerk considers valid but with no usable email is not the
    // same state as "signed out" — returning null here would send this user
    // into a silent sign-in/sign-out redirect loop instead of a visible error.
    throw new Error(
      `Clerk session for subject "${subject}" has no primary email address; cannot provision a user`,
    );
  }

  const row = await findOrCreateUser(db, { ...identity, email });
  return { id: userId(row.id), email: row.email };
});
