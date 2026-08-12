import { z } from 'zod';

// Our own identity, never a provider's. Once a Clerk subject id were a foreign
// key on every table, replacing Clerk would mean rewriting the database — see
// ADR 0009. `UserId` is branded so it can never be passed where a raw string
// (an auth provider's subject id, say) is expected.
export const userIdSchema = z.string().uuid().brand<'UserId'>();

export type UserId = z.infer<typeof userIdSchema>;

export function userId(value: string): UserId {
  return userIdSchema.parse(value);
}

export interface AuthenticatedUser {
  readonly id: UserId;
  readonly email: string;
}

/**
 * Ambient port: who is making this request. `core` depends on this interface
 * and nothing about how it is answered — the Clerk-specific implementation
 * lives behind `apps/web/src/lib/auth/`, the one directory ADR 0009 permits to
 * know Clerk exists.
 */
export interface SessionProvider {
  current(): Promise<AuthenticatedUser | null>;
}
