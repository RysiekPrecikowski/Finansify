import { type InstrumentId } from '../ledger/types';
import { type Clock } from '../ports/clock';
import { Temporal } from '../time';
import { type MarketPriceRepository, type PriceProvider, type SymbolRepository } from './ports';
import { type PriceBar, type PriceLookup, type RefreshReport, type StoredBar } from './types';

/**
 * One TTL for every instrument, every granularity: section 03's decision. No
 * market calendar — after close this refetches the same value every 15
 * minutes, which is cheap and correct rather than clever and wrong.
 */
export const PRICE_TTL_MINUTES = 15;

function isStale(fetchedAt: Temporal.Instant, now: Temporal.Instant): boolean {
  return now.since(fetchedAt).total('minutes') > PRICE_TTL_MINUTES;
}

function isDue(bar: StoredBar | undefined, now: Temporal.Instant): boolean {
  return bar === undefined || isStale(bar.fetchedAt, now);
}

function toLookup(bar: StoredBar | undefined, now: Temporal.Instant): PriceLookup {
  if (bar === undefined) return { status: 'unavailable', reason: 'never-fetched' };
  return {
    status: isStale(bar.fetchedAt, now) ? 'stale' : 'fresh',
    close: bar.close,
    asOf: bar.date,
    fetchedAt: bar.fetchedAt,
  };
}

/**
 * Reads storage only — see section 02's callout. There is no way to reach the
 * network from this function, which is what makes it safe to call from the
 * render path.
 */
export function makeReadPrices(deps: { prices: MarketPriceRepository; clock: Clock }) {
  return async function readPrices(
    ids: readonly InstrumentId[],
  ): Promise<ReadonlyMap<InstrumentId, PriceLookup>> {
    const stored = await deps.prices.latestFor(ids);
    const now = deps.clock.now();
    const result = new Map<InstrumentId, PriceLookup>();
    for (const id of ids) result.set(id, toLookup(stored.get(id), now));
    return result;
  };
}

/**
 * A bar the provider handed back must still earn its way into storage: a
 * non-positive close or a session dated in the future is a provider bug, not a
 * price, and section 08 says to reject it rather than "fix" it.
 */
function isUsable(bar: PriceBar, now: Temporal.Instant): boolean {
  if (!bar.close.isPositive()) return false;
  const today = now.toZonedDateTimeISO('UTC').toPlainDate();
  return Temporal.PlainDate.compare(bar.date, today) <= 0;
}

/**
 * Fetches what is due (missing or past its TTL) and saves it. Never called
 * from the render path — only from the `<Suspense>` boundary in section 03.
 *
 * The circuit breaker is section 08's: two consecutive failures stop the
 * whole round rather than hammering a provider that is down. What's left
 * undone simply stays `stale`, which is a normal, valuable state — not an
 * error the caller has to recover from.
 */
export function makeRefreshPrices(deps: {
  prices: MarketPriceRepository;
  symbols: SymbolRepository;
  provider: PriceProvider;
  clock: Clock;
}) {
  return async function refreshPrices(
    ids: readonly InstrumentId[],
  ): Promise<RefreshReport<InstrumentId>> {
    const now = deps.clock.now();
    const [stored, resolved] = await Promise.all([
      deps.prices.latestFor(ids),
      deps.symbols.resolvedFor(ids),
    ]);

    const refreshed: InstrumentId[] = [];
    const unmapped: InstrumentId[] = [];
    const failed: InstrumentId[] = [];
    let consecutiveFailures = 0;

    for (const id of ids) {
      if (!isDue(stored.get(id), now)) continue;

      const ref = resolved.get(id);
      if (ref === undefined) {
        unmapped.push(id);
        continue;
      }

      if (consecutiveFailures >= 2) break;

      try {
        const from = now.toZonedDateTimeISO('UTC').toPlainDate().subtract({ days: 5 });
        const bars = await deps.provider.fetchDailyBars(ref, from);
        const usable = bars.filter((bar) => isUsable(bar, now));
        if (usable.length === 0) throw new Error(`No usable bars for ${ref.symbol}`);
        await deps.prices.save(usable, deps.provider.name);
        refreshed.push(id);
        consecutiveFailures = 0;
      } catch {
        failed.push(id);
        consecutiveFailures += 1;
      }
    }

    return { refreshed, unmapped, failed };
  };
}
