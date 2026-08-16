import { type InstrumentId } from '../ledger/types';
import { type Clock } from '../ports/clock';
import { type Currency } from '../money';
import { Temporal } from '../time';
import {
  type FxRate,
  type PriceBar,
  type ResolvedSymbol,
  type StoredBar,
  type StoredFxRate,
} from './types';
import { type FxRateRepository, type MarketPriceRepository, type SymbolRepository } from './ports';
import { type ProviderName } from './vocabulary';

/**
 * Test doubles for the valuation ports, colocated the same way
 * `ledger/in-memory-ledger.ts` is: a fake, not production code, shared by
 * every test in this domain rather than copied into each one (rule 13).
 */

export class InMemoryMarketPrices implements MarketPriceRepository {
  private readonly rows = new Map<InstrumentId, StoredBar>();

  constructor(private readonly clock: Clock) {}

  latestFor(ids: readonly InstrumentId[]): Promise<ReadonlyMap<InstrumentId, StoredBar>> {
    const result = new Map<InstrumentId, StoredBar>();
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row !== undefined) result.set(id, row);
    }
    return Promise.resolve(result);
  }

  save(bars: readonly PriceBar[], source: ProviderName): Promise<void> {
    const fetchedAt = this.clock.now();
    for (const bar of bars) {
      // Upsert-by-latest-date, mirroring the `(instrument_id, date)` primary
      // key: only the newest bar per instrument is kept as "latest".
      const existing = this.rows.get(bar.instrumentId);
      if (existing !== undefined && Temporal.PlainDate.compare(existing.date, bar.date) > 0) {
        continue;
      }
      this.rows.set(bar.instrumentId, { ...bar, source, fetchedAt });
    }
    return Promise.resolve();
  }
}

export class InMemorySymbols implements SymbolRepository {
  private readonly rows = new Map<InstrumentId, ResolvedSymbol>();

  resolvedFor(ids: readonly InstrumentId[]): Promise<ReadonlyMap<InstrumentId, ResolvedSymbol>> {
    const result = new Map<InstrumentId, ResolvedSymbol>();
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row !== undefined) result.set(id, row);
    }
    return Promise.resolve(result);
  }

  save(ref: ResolvedSymbol): Promise<void> {
    this.rows.set(ref.instrumentId, ref);
    return Promise.resolve();
  }
}

export class InMemoryFxRates implements FxRateRepository {
  /** The whole history per currency, keyed by date — `fx_rates`'s own primary key. */
  private readonly rows = new Map<Currency, Map<string, StoredFxRate>>();

  constructor(private readonly clock: Clock) {}

  latestFor(currencies: readonly Currency[]): Promise<ReadonlyMap<Currency, StoredFxRate>> {
    const result = new Map<Currency, StoredFxRate>();
    for (const code of currencies) {
      const newest = this.sorted(code).at(-1);
      if (newest !== undefined) result.set(code, newest);
    }
    return Promise.resolve(result);
  }

  seriesFor(
    currencies: readonly Currency[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
  ): Promise<ReadonlyMap<Currency, readonly StoredFxRate[]>> {
    const result = new Map<Currency, readonly StoredFxRate[]>();
    for (const code of currencies) {
      const inRange = this.sorted(code).filter(
        (row) =>
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
      byDate.set(rate.date.toString(), { ...rate, source, fetchedAt });
      this.rows.set(rate.currency, byDate);
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
