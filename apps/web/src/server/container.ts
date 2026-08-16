import {
  createDbClient,
  createFileStore,
  fxRateRepository,
  importRepository,
  instrumentRepository,
  ledgerRepository,
  marketPriceRepository,
  symbolRepository,
  type Database,
} from '@finansify/db';
import { xtbStatementParser } from '@finansify/importers';
import {
  Temporal,
  type Clock,
  type FileStore,
  type FxRateProvider,
  type FxRateRepository,
  type InstrumentRepository,
  type InstrumentSearchProvider,
  type MarketPriceRepository,
  type PriceProvider,
  type ScopedImportRepository,
  type ScopedLedgerRepository,
  type StatementParser,
  type SymbolRepository,
  type UserId,
} from '@finansify/core';
import { nbpFxRateProvider, yahooInstrumentSearch, yahooPriceProvider } from '@finansify/providers';
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

export function getInstrumentSearchProvider(): InstrumentSearchProvider {
  return yahooInstrumentSearch;
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

export const scopedImportsFor = cache((userId: UserId): ScopedImportRepository => {
  return importRepository(getDb()).forUser(userId);
});

let cachedFileStore: FileStore | undefined;

export function getFileStore(): FileStore {
  // Named for the store, not the generic default: this project's Blob store
  // is "imports", so the Vercel Marketplace integration emits
  // `BLOB_IMPORTS_READ_WRITE_TOKEN` rather than `BLOB_READ_WRITE_TOKEN`.
  cachedFileStore ??= createFileStore(requiredEnv('BLOB_IMPORTS_READ_WRITE_TOKEN'));
  return cachedFileStore;
}

/** Every registered broker parser — just XTB today (ADR 0015, ticket for Boś not started). */
export function getStatementParsers(): readonly StatementParser[] {
  return [xtbStatementParser];
}
