import { currentUser } from '@clerk/nextjs/server';

/**
 * Returns the signed-in user, or null.
 *
 * Wraps Clerk's `currentUser()` so call sites stay stable if the auth provider
 * ever changes again -- see ADR 0008.
 */
export async function getCurrentUser() {
  return currentUser();
}
