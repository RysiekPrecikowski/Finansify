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

/** Like `getCurrentUser`, but throws instead of returning null. Routes behind `proxy.ts`
 * already require a session, so a null user here means the auth check was bypassed. */
export async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user.id;
}
