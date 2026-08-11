import { auth, currentUser } from '@clerk/nextjs/server';
import { findOrCreateUser } from '@finansify/db';
import { userId, type AuthenticatedUser } from '@finansify/core';

import { getDb } from '@/server/container';

/**
 * The one function everything outside this directory calls — never Clerk's
 * `auth()` or `currentUser()` directly (ADR 0009, rule 2).
 *
 * The local `users` row is provisioned here, lazily, on a cache miss, rather
 * than by a signup webhook: every call pays the same lookup either way, so this
 * adds no cost over the webhook path, and there is exactly one creation path
 * instead of two.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const { userId: subject } = await auth();
  if (subject === null) return null;

  const email = (await currentUser())?.primaryEmailAddress?.emailAddress;
  if (email === undefined) return null;

  const row = await findOrCreateUser(getDb(), {
    authProvider: 'clerk',
    authSubject: subject,
    email,
  });

  return { id: userId(row.id), email: row.email };
}
