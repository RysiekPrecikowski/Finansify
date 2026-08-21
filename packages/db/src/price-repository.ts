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
  type SeriesGrain,
  type StoredBar,
  type StoredFxRate,
  type SymbolRepository,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';

import { type Database } from './client';
import { instruments } from './schema/instruments';
import {
  fxRateCoverage,
  fxRates,
  instrumentIdentifiers,
  instrumentPriceCoverage,
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

/**
 * `date_trunc`'s bucket boundary for `historyFor`'s `week`/`month` grains —
 * never called for `day`, which needs no bucketing at all.
 *
 * `grain` is interpolated as raw SQL text, not bound as a query parameter —
 * deliberately, and only because the closed `SeriesGrain` union makes it safe
 * (never raw user input reaching this far unvalidated). Binding it as a normal
 * parameter instead produces two *different* placeholders (`$1`, `$18`) for
 * the two call sites below — one inside `selectDistinctOn`'s expression list,
 * one inside `.orderBy(...)` — even though both carry the same value at
 * runtime. Postgres's `DISTINCT ON` requires its expressions to be the exact
 * same parse-tree nodes as the leading `ORDER BY` expressions, and two
 * distinct `Param` nodes fail that match regardless of what they're bound to:
 * `SELECT DISTINCT ON expressions must match initial ORDER BY expressions`.
 * Raw text makes both occurrences literally identical SQL, which is what the
 * match actually requires. Confirmed against a live Neon branch.
 */
function bucketExpr(grain: 'week' | 'month', column: PgColumn) {
  return sql`date_trunc(${sql.raw(`'${grain}'`)}, ${column}::date)`;
}

export function marketPriceRepository(db: Database): MarketPriceRepository {
  return {
    async latestFor(ids: readonly InstrumentId[], source: ProviderName) {
      if (ids.length === 0) return new Map();
      // `DISTINCT ON` returns one row per instrument — its newest bar — rather
      // than the whole price history for a JS loop to discard. This runs on
      // every `/portfolio` valuation, and `instrument_prices` gains a row per
      // instrument per session day, so pulling history here would get slower
      // without bound.
      const rows = await db
        .selectDistinctOn([instrumentPrices.instrumentId])
        .from(instrumentPrices)
        .where(
          and(
            inArray(instrumentPrices.instrumentId, [...ids]),
            eq(instrumentPrices.source, source),
          ),
        )
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
          // Matches the primary key, `source` included: a Yahoo close and a
          // GPW close for the same instrument-day are two rows, not one
          // overwriting the other (ADR 0022).
          target: [instrumentPrices.instrumentId, instrumentPrices.date, instrumentPrices.source],
          set: {
            close: sql`excluded.close`,
            currency: sql`excluded.currency`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },

    async historyFor(
      ids: readonly InstrumentId[],
      from: Temporal.PlainDate,
      to: Temporal.PlainDate,
      grain: SeriesGrain,
      source: ProviderName,
    ) {
      if (ids.length === 0) return new Map();
      const idList = [...ids];

      // The left-edge anchor: the last bar strictly before `from`, one per
      // instrument, so a caller can carry a price into day one instead of
      // showing a gap there.
      const anchorRows = await db
        .selectDistinctOn([instrumentPrices.instrumentId])
        .from(instrumentPrices)
        .where(
          and(
            inArray(instrumentPrices.instrumentId, idList),
            eq(instrumentPrices.source, source),
            lt(instrumentPrices.date, from.toString()),
          ),
        )
        .orderBy(instrumentPrices.instrumentId, desc(instrumentPrices.date));

      const inRange = and(
        inArray(instrumentPrices.instrumentId, idList),
        eq(instrumentPrices.source, source),
        gte(instrumentPrices.date, from.toString()),
        lte(instrumentPrices.date, to.toString()),
      );

      // `day` needs no bucketing; `week`/`month` keep the last close in each
      // `date_trunc` bucket via `DISTINCT ON`, re-sorted ascending below —
      // `ORDER BY ... DESC` is what `DISTINCT ON` needs to pick the *last*
      // row per bucket, not the display order.
      const rangeRows =
        grain === 'day'
          ? await db
              .select()
              .from(instrumentPrices)
              .where(inRange)
              .orderBy(instrumentPrices.instrumentId, asc(instrumentPrices.date))
          : await db
              .selectDistinctOn([
                instrumentPrices.instrumentId,
                bucketExpr(grain, instrumentPrices.date),
              ])
              .from(instrumentPrices)
              .where(inRange)
              .orderBy(
                instrumentPrices.instrumentId,
                bucketExpr(grain, instrumentPrices.date),
                desc(instrumentPrices.date),
              );

      const byInstrument = new Map<InstrumentId, StoredBar[]>();
      for (const row of anchorRows) {
        byInstrument.set(toInstrumentId(row.instrumentId), [toStoredBar(row)]);
      }
      for (const row of rangeRows) {
        const id = toInstrumentId(row.instrumentId);
        const bars = byInstrument.get(id) ?? [];
        bars.push(toStoredBar(row));
        byInstrument.set(id, bars);
      }

      const result = new Map<InstrumentId, readonly StoredBar[]>();
      for (const [id, bars] of byInstrument) {
        result.set(
          id,
          bars.sort((a, b) => Temporal.PlainDate.compare(a.date, b.date)),
        );
      }
      return result;
    },

    async coverageFor(ids: readonly InstrumentId[], source: ProviderName) {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select()
        .from(instrumentPriceCoverage)
        .where(
          and(
            inArray(instrumentPriceCoverage.instrumentId, [...ids]),
            eq(instrumentPriceCoverage.source, source),
          ),
        );

      const result = new Map<InstrumentId, Temporal.PlainDate>();
      for (const row of rows) {
        result.set(toInstrumentId(row.instrumentId), Temporal.PlainDate.from(row.coveredFrom));
      }
      return result;
    },

    async markCovered(
      ids: readonly InstrumentId[],
      source: ProviderName,
      from: Temporal.PlainDate,
    ) {
      if (ids.length === 0) return;
      const checkedAt = new Date();
      await db
        .insert(instrumentPriceCoverage)
        .values(
          ids.map((instrumentId) => ({
            instrumentId,
            source,
            coveredFrom: from.toString(),
            checkedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [instrumentPriceCoverage.instrumentId, instrumentPriceCoverage.source],
          set: {
            // Widens only: a narrower later call must never shrink coverage
            // an earlier, wider backfill already established.
            coveredFrom: sql`LEAST(${instrumentPriceCoverage.coveredFrom}, excluded.covered_from)`,
            checkedAt: sql`excluded.checked_at`,
          },
        });
    },
  };
}

async function chainFor(
  db: Database,
  ids: readonly InstrumentId[],
): Promise<ReadonlyMap<InstrumentId, readonly ResolvedSymbol[]>> {
  if (ids.length === 0) return new Map();
  // `instrument_identifiers` carries no currency or kind of its own — the
  // instrument's own row is the source of truth an adapter verifies its
  // response against (ADR 0014), so both are joined in here rather than
  // duplicated onto every mapping row.
  const rows = await db
    .select({
      instrumentId: instrumentIdentifiers.instrumentId,
      provider: instrumentIdentifiers.provider,
      symbol: instrumentIdentifiers.symbol,
      currency: instruments.currency,
      kind: instruments.kind,
    })
    .from(instrumentIdentifiers)
    .innerJoin(instruments, eq(instruments.id, instrumentIdentifiers.instrumentId))
    .where(inArray(instrumentIdentifiers.instrumentId, [...ids]))
    // Lowest `priority` first — the chain order `provider-chain.ts` routes
    // over (ADR 0022). `provider` is only a tie-break for two rows sharing a
    // priority (both still at the column default, say), so the order is
    // deterministic rather than whatever order Postgres returns.
    .orderBy(
      instrumentIdentifiers.instrumentId,
      instrumentIdentifiers.priority,
      instrumentIdentifiers.provider,
    );

  const result = new Map<InstrumentId, ResolvedSymbol[]>();
  for (const row of rows) {
    const id = toInstrumentId(row.instrumentId);
    const chain = result.get(id) ?? [];
    chain.push({
      instrumentId: id,
      provider: row.provider,
      symbol: row.symbol,
      currency: toCurrency(row.currency),
      kind: row.kind,
    });
    result.set(id, chain);
  }
  return result;
}

export function symbolRepository(db: Database): SymbolRepository {
  return {
    async resolvedFor(ids: readonly InstrumentId[]) {
      const chains = await chainFor(db, ids);
      const result = new Map<InstrumentId, ResolvedSymbol>();
      for (const [id, chain] of chains) {
        const first = chain[0];
        if (first !== undefined) result.set(id, first);
      }
      return result;
    },

    chainFor: (ids: readonly InstrumentId[]) => chainFor(db, ids),

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

    async recordFallback(instrumentId: InstrumentId, provider: ProviderName) {
      await db
        .update(instrumentIdentifiers)
        .set({
          fallbackCount: sql`${instrumentIdentifiers.fallbackCount} + 1`,
          lastFallbackAt: new Date(),
        })
        .where(
          and(
            eq(instrumentIdentifiers.instrumentId, instrumentId),
            eq(instrumentIdentifiers.provider, provider),
          ),
        );
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

    async historyFor(
      currencies: readonly Currency[],
      from: Temporal.PlainDate,
      to: Temporal.PlainDate,
      grain: SeriesGrain,
      source: ProviderName,
    ) {
      if (currencies.length === 0) return new Map();
      const codeList = [...currencies];

      const anchorRows = await db
        .selectDistinctOn([fxRates.currency])
        .from(fxRates)
        .where(
          and(
            inArray(fxRates.currency, codeList),
            eq(fxRates.source, source),
            lt(fxRates.date, from.toString()),
          ),
        )
        .orderBy(fxRates.currency, desc(fxRates.date));

      const inRange = and(
        inArray(fxRates.currency, codeList),
        eq(fxRates.source, source),
        gte(fxRates.date, from.toString()),
        lte(fxRates.date, to.toString()),
      );

      const rangeRows =
        grain === 'day'
          ? await db
              .select()
              .from(fxRates)
              .where(inRange)
              .orderBy(fxRates.currency, asc(fxRates.date))
          : await db
              .selectDistinctOn([fxRates.currency, bucketExpr(grain, fxRates.date)])
              .from(fxRates)
              .where(inRange)
              .orderBy(fxRates.currency, bucketExpr(grain, fxRates.date), desc(fxRates.date));

      const byCurrency = new Map<Currency, StoredFxRate[]>();
      for (const row of anchorRows) {
        byCurrency.set(toCurrency(row.currency), [toStoredFxRate(row)]);
      }
      for (const row of rangeRows) {
        const code = toCurrency(row.currency);
        const series = byCurrency.get(code) ?? [];
        series.push(toStoredFxRate(row));
        byCurrency.set(code, series);
      }

      const result = new Map<Currency, readonly StoredFxRate[]>();
      for (const [code, series] of byCurrency) {
        result.set(
          code,
          series.sort((a, b) => Temporal.PlainDate.compare(a.date, b.date)),
        );
      }
      return result;
    },

    async coverageFor(currencies: readonly Currency[], source: ProviderName) {
      if (currencies.length === 0) return new Map();
      const rows = await db
        .select()
        .from(fxRateCoverage)
        .where(
          and(inArray(fxRateCoverage.currency, [...currencies]), eq(fxRateCoverage.source, source)),
        );

      const result = new Map<Currency, Temporal.PlainDate>();
      for (const row of rows) {
        result.set(toCurrency(row.currency), Temporal.PlainDate.from(row.coveredFrom));
      }
      return result;
    },

    async markCovered(
      currencies: readonly Currency[],
      source: ProviderName,
      from: Temporal.PlainDate,
    ) {
      if (currencies.length === 0) return;
      const checkedAt = new Date();
      await db
        .insert(fxRateCoverage)
        .values(
          currencies.map((code) => ({
            currency: code,
            source,
            coveredFrom: from.toString(),
            checkedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [fxRateCoverage.currency, fxRateCoverage.source],
          set: {
            coveredFrom: sql`LEAST(${fxRateCoverage.coveredFrom}, excluded.covered_from)`,
            checkedAt: sql`excluded.checked_at`,
          },
        });
    },
  };
}
