import {
  currency as toCurrency,
  instrumentId as toInstrumentId,
  Money,
  Temporal,
  type Currency,
  type FxRate,
  type FxRateRepository,
  type InstrumentId,
  type MarketPriceRepository,
  type PriceBar,
  type ProviderName,
  type ResolvedSymbol,
  type StoredBar,
  type StoredFxRate,
  type SymbolRepository,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { desc, eq, inArray, sql } from 'drizzle-orm';

import { type Database } from './client';
import { instruments } from './schema/instruments';
import {
  fxRates,
  instrumentIdentifiers,
  instrumentPrices,
  type FxRateRow,
  type InstrumentPriceRow,
} from './schema/prices';

/**
 * The persistence adapters for `core`'s valuation ports (ADR 0014). All three
 * tables are global — no `userId` anywhere in this file, same reasoning as
 * `instrumentRepository` in `ledger-repository.ts`.
 *
 * `numeric` columns arrive as strings and go straight to `Decimal`/`Money`; no
 * `Number()` anywhere here (rule 1).
 */

function toInstant(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

function toStoredBar(row: InstrumentPriceRow): StoredBar {
  const rowCurrency = toCurrency(row.currency);
  return {
    instrumentId: toInstrumentId(row.instrumentId),
    date: Temporal.PlainDate.from(row.date),
    close: Money.of(row.close, rowCurrency),
    source: row.source,
    fetchedAt: toInstant(row.fetchedAt),
  };
}

function toStoredFxRate(row: FxRateRow): StoredFxRate {
  return {
    currency: toCurrency(row.currency),
    date: Temporal.PlainDate.from(row.date),
    mid: new Decimal(row.mid),
    source: row.source,
    fetchedAt: toInstant(row.fetchedAt),
  };
}

export function marketPriceRepository(db: Database): MarketPriceRepository {
  return {
    async latestFor(ids: readonly InstrumentId[]) {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select()
        .from(instrumentPrices)
        .where(inArray(instrumentPrices.instrumentId, [...ids]))
        .orderBy(desc(instrumentPrices.date));

      const result = new Map<InstrumentId, StoredBar>();
      for (const row of rows) {
        const id = toInstrumentId(row.instrumentId);
        // Rows arrive ordered newest date first — the first row seen per
        // instrument is its latest bar, later ones are ignored.
        if (!result.has(id)) result.set(id, toStoredBar(row));
      }
      return result;
    },

    async save(bars: readonly PriceBar[], source: ProviderName) {
      if (bars.length === 0) return;
      const fetchedAt = new Date();
      await db
        .insert(instrumentPrices)
        .values(
          bars.map((bar) => ({
            instrumentId: bar.instrumentId,
            date: bar.date.toString(),
            close: bar.close.amount.toFixed(8),
            currency: bar.close.currency,
            source,
            fetchedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [instrumentPrices.instrumentId, instrumentPrices.date],
          set: {
            close: sql`excluded.close`,
            currency: sql`excluded.currency`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },
  };
}

export function symbolRepository(db: Database): SymbolRepository {
  return {
    async resolvedFor(ids: readonly InstrumentId[]) {
      if (ids.length === 0) return new Map();
      // `instrument_identifiers` carries no currency of its own — the
      // instrument's own row is the source of truth an adapter verifies its
      // response against (ADR 0014), so it's joined in here rather than
      // duplicated onto every mapping row.
      const rows = await db
        .select({
          instrumentId: instrumentIdentifiers.instrumentId,
          provider: instrumentIdentifiers.provider,
          symbol: instrumentIdentifiers.symbol,
          currency: instruments.currency,
        })
        .from(instrumentIdentifiers)
        .innerJoin(instruments, eq(instruments.id, instrumentIdentifiers.instrumentId))
        .where(inArray(instrumentIdentifiers.instrumentId, [...ids]));

      const result = new Map<InstrumentId, ResolvedSymbol>();
      for (const row of rows) {
        result.set(toInstrumentId(row.instrumentId), {
          instrumentId: toInstrumentId(row.instrumentId),
          provider: row.provider,
          symbol: row.symbol,
          currency: toCurrency(row.currency),
        });
      }
      return result;
    },

    async save(ref: ResolvedSymbol) {
      await db
        .insert(instrumentIdentifiers)
        .values({
          instrumentId: ref.instrumentId,
          provider: ref.provider,
          symbol: ref.symbol,
          verifiedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [instrumentIdentifiers.instrumentId, instrumentIdentifiers.provider],
          set: { symbol: ref.symbol, verifiedAt: new Date() },
        });
    },
  };
}

export function fxRateRepository(db: Database): FxRateRepository {
  return {
    async latestFor(currencies: readonly Currency[]) {
      if (currencies.length === 0) return new Map();
      const rows = await db
        .select()
        .from(fxRates)
        .where(inArray(fxRates.currency, [...currencies]))
        .orderBy(desc(fxRates.date));

      const result = new Map<Currency, StoredFxRate>();
      for (const row of rows) {
        const code = toCurrency(row.currency);
        if (!result.has(code)) result.set(code, toStoredFxRate(row));
      }
      return result;
    },

    async save(rates: readonly FxRate[], source: ProviderName) {
      if (rates.length === 0) return;
      const fetchedAt = new Date();
      await db
        .insert(fxRates)
        .values(
          rates.map((rate) => ({
            currency: rate.currency,
            date: rate.date.toString(),
            mid: rate.mid.toFixed(8),
            source,
            fetchedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [fxRates.currency, fxRates.date],
          set: {
            mid: sql`excluded.mid`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },
  };
}
