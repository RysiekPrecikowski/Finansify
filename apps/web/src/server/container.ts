import {
  createDbClient,
  fxRateRepository,
  instrumentRepository,
  ledgerRepository,
  marketPriceRepository,
  symbolRepository,
  type Database,
} from '@finansify/db';
import {
  Temporal,
  type Clock,
  type FxRateProvider,
  type FxRateRepository,
  type InstrumentRepository,
  type MarketPriceRepository,
  type PriceProvider,
  type ScopedLedgerRepository,
  type SymbolRepository,
  type SymbolResolver,
  type UserId,
} from '@finansify/core';
import { nbpFxRateProvider, yahooPriceProvider, yahooSymbolResolver } from '@finansify/providers';
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
 * Prices, symbol mappings and FX rates are global (ADR 0010) — no
 * `forUser`, same as `getInstruments()`. See ADR 0014 for the ports these
 * implement and `apps/web/AGENTS.md` for why they're read separately from
 * `<Suspense>`, never from the render path directly.
 */
export function getMarketPrices(): MarketPriceRepository {
  return marketPriceRepository(getDb());
}

export function getSymbols(): SymbolRepository {
  return symbolRepository(getDb());
}

export function getFxRates(): FxRateRepository {
  return fxRateRepository(getDb());
}

export function getPriceProvider(): PriceProvider {
  return yahooPriceProvider;
}

export function getSymbolResolver(): SymbolResolver {
  return yahooSymbolResolver;
}

export function getFxProvider(): FxRateProvider {
  return nbpFxRateProvider;
}

export const clock: Clock = { now: () => Temporal.Now.instant() };

/**
 * Memoized with React's `cache()`, keyed on `userId`: callers pass
 * `getCurrentUser()`'s id rather than reaching for `ledgerRepository` directly,
 * so every query in a request goes through the same scoped instance instead of
 * re-deriving it (rule 4, ADR 0009).
 */
export const scopedLedgerFor = cache((userId: UserId): ScopedLedgerRepository => {
  return ledgerRepository(getDb()).forUser(userId);
});
