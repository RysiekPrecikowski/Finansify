'use client';

import { useClerk, useUser } from '@clerk/nextjs';

/**
 * Client-side auth affordances, kept here because `src/lib/auth/` is the only
 * directory permitted to import `@clerk/nextjs` (ADR 0009, `apps/web/AGENTS.md`).
 * A component that needs to sign out or show a display name calls one of these
 * rather than reaching for Clerk itself.
 */

/**
 * The one sign-out call site. `UserMenu` and the mobile drawer both use it, so
 * the redirect target is decided once — two components each calling
 * `signOut({ redirectUrl: … })` is how they end up disagreeing about where a
 * signed-out user lands.
 */
export function useSignOut(): () => void {
  const { signOut } = useClerk();
  return () => void signOut({ redirectUrl: '/sign-in' });
}

export interface DisplayIdentity {
  /** Clerk's full name, falling back to the email's local part — never empty. */
  readonly name: string;
  /** Clerk's avatar, or `null` when the account has no image and the UI should draw a placeholder. */
  readonly imageUrl: string | null;
}

/**
 * The signed-in user's *presentational* identity.
 *
 * Deliberately separate from `AuthenticatedUser`, which `core` defines as id
 * plus email and nothing else (`packages/core/src/ports/session.ts`). A display
 * name is not something the domain has an opinion about, and adding one to that
 * port would push a Clerk profile detail through `core` and the database for
 * the sake of one drawer row. So the email — the fact the domain does own —
 * arrives as a prop from the server, and this hook adds only the decoration.
 *
 * Returns `null` until Clerk has loaded, so a caller can render the email alone
 * rather than flashing a placeholder name.
 */
export function useDisplayIdentity(email: string): DisplayIdentity | null {
  const { isLoaded, user } = useUser();
  if (!isLoaded) return null;

  const fullName = user?.fullName?.trim();
  return {
    name: fullName !== undefined && fullName !== '' ? fullName : (email.split('@')[0] ?? email),
    imageUrl: user?.hasImage === true ? user.imageUrl : null,
  };
}
