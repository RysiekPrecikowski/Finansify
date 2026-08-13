import {
  createDbClient,
  instrumentRepository,
  ledgerRepository,
  type Database,
} from '@finansify/db';
import type { InstrumentRepository, ScopedLedgerRepository, UserId } from '@finansify/core';
import { cache } from 'react';

/**
 * The composition root: the only place adapters get instantiated. Route
 * handlers, server components, and server actions call the exports here — they
 * never construct an adapter themselves. See apps/web/AGENTS.md.
 *
 * `src/lib/auth/get-current-user.ts` is the one exception: it composes
 * `@clerk/nextjs` with `@finansify/db`'s `users` functions directly, using
 * `getDb()` below. ADR 0009 places the `SessionProvider` implementation inside
 * the auth adapter itself, not here — see the note in apps/web/AGENTS.md.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

let cached: Database | undefined;

/**
 * Lazy rather than a top-level `export const db = ...`: a module evaluated
 * without `DATABASE_URL` set (a build step, a route that never touches the
 * database) should not fail just because it was imported.
 */
export function getDb(): Database {
  cached ??= createDbClient(requiredEnv('DATABASE_URL'));
  return cached;
}

export function getInstruments(): InstrumentRepository {
  return instrumentRepository(getDb());
}

/**
 * Memoized with React's `cache()`, keyed on `userId`: callers pass
 * `getCurrentUser()`'s id rather than reaching for `ledgerRepository` directly,
 * so every query in a request goes through the same scoped instance instead of
 * re-deriving it (rule 4, ADR 0009).
 */
export const scopedLedgerFor = cache((userId: UserId): ScopedLedgerRepository => {
  return ledgerRepository(getDb()).forUser(userId);
});
