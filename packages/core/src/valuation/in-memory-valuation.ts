import { type InstrumentId } from '../ledger/types';
import { type Clock } from '../ports/clock';
import { type Currency } from '../money';
import { Temporal } from '../time';
import {
  type FxRate,
  type PriceBar,
  type ResolvedSymbol,
  type SeriesGrain,
  type StoredBar,
  type StoredFxRate,
  type SymbolMapping,
} from './types';
import { type FxRateRepository, type MarketPriceRepository, type SymbolRepository } from './ports';
import { type ProviderName } from './vocabulary';

/**
 * Test doubles for the valuation ports, colocated the same way
 * `ledger/in-memory-ledger.ts` is: a fake, not production code, shared by
 * every test in this domain rather than copied into each one (rule 13).
 */

/**
 * Buckets an ascending series to one row per `grain` bucket, keeping the last
 * row seen in each — the in-memory mirror of `historyFor`'s `DISTINCT ON`
 * query in `packages/db`. Alignment (which Monday, which 1st-of-month) is not
 * meant to match the SQL implementation bar-for-bar; nothing downstream cares,
 * because `portfolioValueSeries` only ever walks the result forward with a
 * carry-forward cursor, never assumes a specific bucket boundary.
 */
function bucketByGrain<T>(
  rows: readonly T[],
  dateOf: (row: T) => Temporal.PlainDate,
  grain: SeriesGrain,
): readonly T[] {
  if (grain === 'day') return rows;

  const buckets = new Map<string, T>();
  for (const row of rows) {
    const date = dateOf(row);
    const key =
      grain === 'week'
        ? date.subtract({ days: date.dayOfWeek - 1 }).toString()
        : `${date.year}-${String(date.month).padStart(2, '0')}`;
    // Rows arrive ascending, so the last write per bucket key is the newest
    // row in that bucket — the same "last close in the bucket" rule the SQL
    // `ORDER BY ... DESC` + `DISTINCT ON` achieves.
    buckets.set(key, row);
  }
  return [...buckets.values()];
}

/** Full history plus a left-edge anchor, ascending — shared by both fakes below. */
function historySlice<T>(
  all: readonly T[],
  dateOf: (row: T) => Temporal.PlainDate,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  grain: SeriesGrain,
): readonly T[] {
  const anchor = all.filter((row) => Temporal.PlainDate.compare(dateOf(row), from) < 0).at(-1);
  const inRange = all.filter(
    (row) =>
      Temporal.PlainDate.compare(dateOf(row), from) >= 0 &&
      Temporal.PlainDate.compare(dateOf(row), to) <= 0,
  );
  const bucketed = bucketByGrain(inRange, dateOf, grain);
  return anchor === undefined ? bucketed : [anchor, ...bucketed];
}

/** Widens `coveredFrom` — never lets a later, narrower call shrink it. */
function widen(
  existing: Temporal.PlainDate | undefined,
  next: Temporal.PlainDate,
): Temporal.PlainDate {
  if (existing === undefined) return next;
  return Temporal.PlainDate.compare(next, existing) < 0 ? next : existing;
}

export class InMemoryMarketPrices implements MarketPriceRepository {
  /** Ascending per instrument — `save` keeps this sorted, deduped by date and source. */
  private readonly history = new Map<InstrumentId, StoredBar[]>();
  private readonly coverage = new Map<InstrumentId, Map<ProviderName, Temporal.PlainDate>>();

  constructor(private readonly clock: Clock) {}

  latestFor(
    ids: readonly InstrumentId[],
    source: ProviderName,
  ): Promise<ReadonlyMap<InstrumentId, StoredBar>> {
    const result = new Map<InstrumentId, StoredBar>();
    for (const id of ids) {
      const bar = this.history
        .get(id)
        ?.filter((row) => row.source === source)
        .at(-1);
      if (bar !== undefined) result.set(id, bar);
    }
    return Promise.resolve(result);
  }

  save(bars: readonly PriceBar[], source: ProviderName): Promise<void> {
    const fetchedAt = this.clock.now();
    for (const bar of bars) {
      const existing = this.history.get(bar.instrumentId) ?? [];
      // Matches `instrument_prices`' key, `(instrument_id, date, source)`: two
      // sources holding a bar for the same day are two rows, not one
      // overwriting the other (ADR 0022).
      const withoutSameRow = existing.filter(
        (row) => !(row.date.equals(bar.date) && row.source === source),
      );
      const merged = [...withoutSameRow, { ...bar, source, fetchedAt }].sort((a, b) =>
        Temporal.PlainDate.compare(a.date, b.date),
      );
      this.history.set(bar.instrumentId, merged);
    }
    return Promise.resolve();
  }

  historyFor(
    ids: readonly InstrumentId[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    grain: SeriesGrain,
    source: ProviderName,
  ): Promise<ReadonlyMap<InstrumentId, readonly StoredBar[]>> {
    const result = new Map<InstrumentId, readonly StoredBar[]>();
    for (const id of ids) {
      const bySource = (this.history.get(id) ?? []).filter((row) => row.source === source);
      const slice = historySlice(bySource, (row) => row.date, from, to, grain);
      if (slice.length > 0) result.set(id, slice);
    }
    return Promise.resolve(result);
  }

  coverageFor(
    ids: readonly InstrumentId[],
    source: ProviderName,
  ): Promise<ReadonlyMap<InstrumentId, Temporal.PlainDate>> {
    const result = new Map<InstrumentId, Temporal.PlainDate>();
    for (const id of ids) {
      const from = this.coverage.get(id)?.get(source);
      if (from !== undefined) result.set(id, from);
    }
    return Promise.resolve(result);
  }

  markCovered(
    ids: readonly InstrumentId[],
    source: ProviderName,
    from: Temporal.PlainDate,
  ): Promise<void> {
    for (const id of ids) {
      const bySource = this.coverage.get(id) ?? new Map<ProviderName, Temporal.PlainDate>();
      bySource.set(source, widen(bySource.get(source), from));
      this.coverage.set(id, bySource);
    }
    return Promise.resolve();
  }
}

/**
 * Chain order is insertion order among `save` calls for an instrument — this
 * fake has no `priority` column to sort by, so a test that cares about order
 * controls it by the order it calls `save` in, same as `chainFor`'s
 * lowest-`priority`-first contract in production.
 */
export class InMemorySymbols implements SymbolRepository {
  private readonly rows = new Map<InstrumentId, ResolvedSymbol[]>();
  private readonly fallbacks = new Map<InstrumentId, Map<ProviderName, number>>();

  resolvedFor(ids: readonly InstrumentId[]): Promise<ReadonlyMap<InstrumentId, ResolvedSymbol>> {
    const result = new Map<InstrumentId, ResolvedSymbol>();
    for (const id of ids) {
      const first = this.rows.get(id)?.[0];
      if (first !== undefined) result.set(id, first);
    }
    return Promise.resolve(result);
  }

  /** No clock here — nothing in this domain reads `verifiedAt`'s actual value, only that it exists. */
  private static readonly EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

  chainFor(
    ids: readonly InstrumentId[],
  ): Promise<ReadonlyMap<InstrumentId, readonly SymbolMapping[]>> {
    const result = new Map<InstrumentId, readonly SymbolMapping[]>();
    for (const id of ids) {
      const chain = this.rows.get(id);
      if (chain === undefined || chain.length === 0) continue;
      result.set(
        id,
        chain.map((ref, priority) => ({
          ...ref,
          priority,
          fallbackCount: this.fallbacks.get(id)?.get(ref.provider) ?? 0,
          lastFallbackAt: null,
          verifiedAt: InMemorySymbols.EPOCH,
        })),
      );
    }
    return Promise.resolve(result);
  }

  save(ref: ResolvedSymbol): Promise<void> {
    const existing = this.rows.get(ref.instrumentId) ?? [];
    const withoutSameProvider = existing.filter((row) => row.provider !== ref.provider);
    this.rows.set(ref.instrumentId, [...withoutSameProvider, ref]);
    return Promise.resolve();
  }

  recordFallback(instrumentId: InstrumentId, provider: ProviderName): Promise<void> {
    const byProvider = this.fallbacks.get(instrumentId) ?? new Map<ProviderName, number>();
    byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
    this.fallbacks.set(instrumentId, byProvider);
    return Promise.resolve();
  }

  fallbackCount(instrumentId: InstrumentId, provider: ProviderName): number {
    return this.fallbacks.get(instrumentId)?.get(provider) ?? 0;
  }

  /**
   * Unlike production (`currency`/`kind` live on `instruments`, joined in at
   * read time), this fake stores them per row — so replacing the chain for an
   * instrument this fake has never seen via `save()` has nothing to carry
   * them over from. Call `save()` once first to establish the instrument
   * (exactly what `select-instrument.ts` already does for a real one) before
   * exercising `setChain` on it.
   */
  setChain(
    instrumentId: InstrumentId,
    entries: readonly { readonly provider: ProviderName; readonly symbol: string }[],
  ): Promise<void> {
    const existing = this.rows.get(instrumentId) ?? [];
    const byProvider = new Map(existing.map((row) => [row.provider, row]));
    const known = existing[0];

    const next = entries.map((entry): ResolvedSymbol => {
      const prior = byProvider.get(entry.provider) ?? known;
      if (prior === undefined) {
        throw new Error(
          `InMemorySymbols.setChain: instrument ${instrumentId} has no known currency/kind — call save() once first`,
        );
      }
      return {
        instrumentId,
        provider: entry.provider,
        symbol: entry.symbol,
        currency: prior.currency,
        kind: prior.kind,
      };
    });

    this.rows.set(instrumentId, next);
    return Promise.resolve();
  }
}

export class InMemoryFxRates implements FxRateRepository {
  /** The whole history per currency, keyed by date — `fx_rates`'s own primary key. */
  private readonly rows = new Map<Currency, Map<string, StoredFxRate>>();
  private readonly coverage = new Map<Currency, Map<ProviderName, Temporal.PlainDate>>();

  constructor(private readonly clock: Clock) {}

  latestFor(
    currencies: readonly Currency[],
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, StoredFxRate>> {
    const result = new Map<Currency, StoredFxRate>();
    for (const code of currencies) {
      const newest = this.sorted(code)
        .filter((row) => row.source === source)
        .at(-1);
      if (newest !== undefined) result.set(code, newest);
    }
    return Promise.resolve(result);
  }

  seriesFor(
    currencies: readonly Currency[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, readonly StoredFxRate[]>> {
    const result = new Map<Currency, readonly StoredFxRate[]>();
    for (const code of currencies) {
      const inRange = this.sorted(code).filter(
        (row) =>
          row.source === source &&
          Temporal.PlainDate.compare(row.date, from) >= 0 &&
          Temporal.PlainDate.compare(row.date, to) <= 0,
      );
      if (inRange.length > 0) result.set(code, inRange);
    }
    return Promise.resolve(result);
  }

  save(rates: readonly FxRate[], source: ProviderName): Promise<void> {
    const fetchedAt = this.clock.now();
    for (const rate of rates) {
      const byDate = this.rows.get(rate.currency) ?? new Map<string, StoredFxRate>();
      // Keyed by date *and* source, matching `fx_rates`'s primary key — two
      // feeds hold a rate for the same day and must not overwrite each other.
      byDate.set(`${rate.date.toString()}:${source}`, { ...rate, source, fetchedAt });
      this.rows.set(rate.currency, byDate);
    }
    return Promise.resolve();
  }

  historyFor(
    currencies: readonly Currency[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    grain: SeriesGrain,
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, readonly StoredFxRate[]>> {
    const result = new Map<Currency, readonly StoredFxRate[]>();
    for (const code of currencies) {
      const all = this.sorted(code).filter((row) => row.source === source);
      const slice = historySlice(all, (row) => row.date, from, to, grain);
      if (slice.length > 0) result.set(code, slice);
    }
    return Promise.resolve(result);
  }

  coverageFor(
    currencies: readonly Currency[],
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, Temporal.PlainDate>> {
    const result = new Map<Currency, Temporal.PlainDate>();
    for (const code of currencies) {
      const from = this.coverage.get(code)?.get(source);
      if (from !== undefined) result.set(code, from);
    }
    return Promise.resolve(result);
  }

  markCovered(
    currencies: readonly Currency[],
    source: ProviderName,
    from: Temporal.PlainDate,
  ): Promise<void> {
    for (const code of currencies) {
      const bySource = this.coverage.get(code) ?? new Map<ProviderName, Temporal.PlainDate>();
      bySource.set(source, widen(bySource.get(source), from));
      this.coverage.set(code, bySource);
    }
    return Promise.resolve();
  }

  private sorted(code: Currency): readonly StoredFxRate[] {
    return [...(this.rows.get(code)?.values() ?? [])].sort((a, b) =>
      Temporal.PlainDate.compare(a.date, b.date),
    );
  }
}

/** A clock a test can move forward, so TTL behaviour doesn't need real waiting. */
export class FakeClock implements Clock {
  constructor(private instant: Temporal.Instant) {}

  now(): Temporal.Instant {
    return this.instant;
  }

  advance(duration: { minutes?: number; hours?: number; days?: number }): void {
    this.instant = this.instant.add(duration);
  }
}
