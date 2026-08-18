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
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

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
      // `DISTINCT ON` returns one row per instrument — its newest bar — rather
      // than the whole price history for a JS loop to discard. This runs on
      // every `/portfolio` valuation, and `instrument_prices` gains a row per
      // instrument per session day, so pulling history here would get slower
      // without bound.
      const rows = await db
        .selectDistinctOn([instrumentPrices.instrumentId])
        .from(instrumentPrices)
        .where(inArray(instrumentPrices.instrumentId, [...ids]))
        .orderBy(instrumentPrices.instrumentId, desc(instrumentPrices.date));

      const result = new Map<InstrumentId, StoredBar>();
      for (const row of rows) result.set(toInstrumentId(row.instrumentId), toStoredBar(row));
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
        .where(inArray(instrumentIdentifiers.instrumentId, [...ids]))
        // The primary key is `(instrument_id, provider)`, so the schema permits
        // several provider rows per instrument while this port's return type
        // admits exactly one. ADR 0014 commits to a single price provider, so
        // that case is unreachable today — ordering by provider makes the
        // choice deterministic rather than whatever order Postgres returns, if
        // a second one is ever added. It is a tie-break, not a priority: a real
        // second provider needs a stated preference here.
        .orderBy(instrumentIdentifiers.provider);

      const result = new Map<InstrumentId, ResolvedSymbol>();
      for (const row of rows) {
        const id = toInstrumentId(row.instrumentId);
        if (result.has(id)) continue;
        result.set(id, {
          instrumentId: id,
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
    async latestFor(currencies: readonly Currency[], source: ProviderName) {
      if (currencies.length === 0) return new Map();
      // One row per currency, newest first — same reasoning as `latestFor` on
      // prices: `fx_rates` gains 32 rows per NBP publication day.
      const rows = await db
        .selectDistinctOn([fxRates.currency])
        .from(fxRates)
        .where(and(inArray(fxRates.currency, [...currencies]), eq(fxRates.source, source)))
        .orderBy(fxRates.currency, desc(fxRates.date));

      const result = new Map<Currency, StoredFxRate>();
      for (const row of rows) result.set(toCurrency(row.currency), toStoredFxRate(row));
      return result;
    },

    async seriesFor(
      currencies: readonly Currency[],
      from: Temporal.PlainDate,
      to: Temporal.PlainDate,
      source: ProviderName,
    ) {
      if (currencies.length === 0) return new Map();

      const rows = await db
        .select()
        .from(fxRates)
        .where(
          and(
            inArray(fxRates.currency, [...currencies]),
            eq(fxRates.source, source),
            gte(fxRates.date, from.toString()),
            lte(fxRates.date, to.toString()),
          ),
        )
        .orderBy(fxRates.currency, fxRates.date);

      // Grouped here rather than in one query per currency: the whole range
      // for a handful of currencies is a few hundred rows, and `orderBy` has
      // already put them in the order the chart wants.
      const result = new Map<Currency, StoredFxRate[]>();
      for (const row of rows) {
        const code = toCurrency(row.currency);
        const series = result.get(code) ?? [];
        series.push(toStoredFxRate(row));
        result.set(code, series);
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
          // Matches the primary key, `source` included: a Yahoo close and an
          // NBP mid for the same day are two rows, not one overwriting the
          // other (ADR 0018).
          target: [fxRates.currency, fxRates.date, fxRates.source],
          set: {
            mid: sql`excluded.mid`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },
  };
}
