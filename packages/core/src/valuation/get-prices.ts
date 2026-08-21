import { type InstrumentId } from '../ledger/types';
import { type Clock } from '../ports/clock';
import { Temporal } from '../time';
import { type MarketPriceRepository, type PriceProvider, type SymbolRepository } from './ports';
import { fetchWithFallback, selectProvider } from './provider-chain';
import {
  type PriceBar,
  type PriceLookup,
  type RefreshReport,
  type ResolvedSymbol,
  type SeriesGrain,
  type StoredBar,
} from './types';
import { type ProviderName } from './vocabulary';

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
 * Walks each id's whole chain, in priority order, one `MarketPriceRepository`
 * call per distinct source per position, until every id either has a stored
 * bar or has run out of chain entries to try. Deliberately not limited to the
 * chain's *first* history-capable entry (unlike `historyFor`'s single-source
 * rule below): fallback is non-sticky (ADR 0022), so the bar that actually
 * landed in storage after the last refresh can be sitting under any entry in
 * the chain, and the latest-price render path must find it wherever it is —
 * showing nothing when a usable value exists would be worse than the "mixing"
 * rule this deliberately doesn't apply to a single point.
 */
async function latestAcrossChain(
  prices: MarketPriceRepository,
  ids: readonly InstrumentId[],
  chains: ReadonlyMap<InstrumentId, readonly ResolvedSymbol[]>,
): Promise<ReadonlyMap<InstrumentId, StoredBar>> {
  const result = new Map<InstrumentId, StoredBar>();
  const pending = new Set(ids);
  let position = 0;

  while (pending.size > 0) {
    const bySource = new Map<ProviderName, InstrumentId[]>();
    for (const id of pending) {
      const entry = chains.get(id)?.[position];
      if (entry === undefined) continue;
      const list = bySource.get(entry.provider) ?? [];
      list.push(id);
      bySource.set(entry.provider, list);
    }
    if (bySource.size === 0) break;

    for (const [source, sourceIds] of bySource) {
      const stored = await prices.latestFor(sourceIds, source);
      for (const id of sourceIds) {
        const bar = stored.get(id);
        if (bar !== undefined) {
          result.set(id, bar);
          pending.delete(id);
        }
      }
    }
    position += 1;
  }

  return result;
}

/**
 * The single source a chart or a backfill commits to per id: the first entry
 * of the chain whose provider can serve history for this kind — never a
 * fallback candidate, because unlike `latestAcrossChain` this feeds a
 * continuous series, and mixing two providers' bars into one line is exactly
 * what "never interpolate, never substitute" (rule 7) rules out. An id absent
 * from the result has no history-capable provider at all.
 */
function primaryHistorySourceFor(
  ids: readonly InstrumentId[],
  chains: ReadonlyMap<InstrumentId, readonly ResolvedSymbol[]>,
  registry: ReadonlyMap<ProviderName, PriceProvider>,
): ReadonlyMap<InstrumentId, ResolvedSymbol> {
  const result = new Map<InstrumentId, ResolvedSymbol>();
  for (const id of ids) {
    const chain = chains.get(id);
    const kind = chain?.[0]?.kind;
    if (chain === undefined || kind === undefined) continue;
    const primary = selectProvider(chain, registry, kind, 'history')[0];
    if (primary !== undefined) result.set(id, primary);
  }
  return result;
}

function groupBySource(
  refs: ReadonlyMap<InstrumentId, ResolvedSymbol>,
): ReadonlyMap<ProviderName, InstrumentId[]> {
  const bySource = new Map<ProviderName, InstrumentId[]>();
  for (const [id, ref] of refs) {
    const list = bySource.get(ref.provider) ?? [];
    list.push(id);
    bySource.set(ref.provider, list);
  }
  return bySource;
}

/**
 * Reads storage only — see section 02's callout. There is no way to reach the
 * network from this function, which is what makes it safe to call from the
 * render path. `symbols.chainFor` is a storage read too (`instrument_identifiers`),
 * not a provider call — routing which source(s) to read from never touches
 * the network.
 */
export function makeReadPrices(deps: {
  prices: MarketPriceRepository;
  symbols: SymbolRepository;
  clock: Clock;
}) {
  return async function readPrices(
    ids: readonly InstrumentId[],
  ): Promise<ReadonlyMap<InstrumentId, PriceLookup>> {
    const chains = await deps.symbols.chainFor(ids);
    const stored = await latestAcrossChain(deps.prices, ids, chains);
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
 * Routes over each instrument's whole chain via `fetchWithFallback` (ADR
 * 0022): a provider that fails is skipped in favor of the next one that can
 * serve `history` for this instrument's kind, and every provider fallen back
 * from is recorded via `recordFallback`. Failing over is never sticky — the
 * chain itself is untouched, so the next round starts from the top again.
 *
 * The circuit breaker is section 08's: two consecutive per-instrument
 * failures (the whole chain exhausted, not one provider) stop the round
 * rather than hammering providers that are down. What's left undone simply
 * stays `stale`, which is a normal, valuable state — not an error the caller
 * has to recover from.
 */
export function makeRefreshPrices(deps: {
  prices: MarketPriceRepository;
  symbols: SymbolRepository;
  providers: ReadonlyMap<ProviderName, PriceProvider>;
  clock: Clock;
}) {
  return async function refreshPrices(
    ids: readonly InstrumentId[],
  ): Promise<RefreshReport<InstrumentId>> {
    const now = deps.clock.now();
    const chains = await deps.symbols.chainFor(ids);
    const stored = await latestAcrossChain(deps.prices, ids, chains);

    const refreshed: InstrumentId[] = [];
    const unmapped: InstrumentId[] = [];
    const failed: InstrumentId[] = [];
    let consecutiveFailures = 0;

    for (const id of ids) {
      if (!isDue(stored.get(id), now)) continue;

      const chain = chains.get(id);
      if (chain === undefined || chain.length === 0) {
        unmapped.push(id);
        continue;
      }

      if (consecutiveFailures >= 2) break;

      const kind = chain[0]!.kind;
      const from = now.toZonedDateTimeISO('UTC').toPlainDate().subtract({ days: 5 });

      const outcome = await fetchWithFallback(
        chain,
        deps.providers,
        kind,
        'history',
        async (provider: PriceProvider, ref: ResolvedSymbol) => {
          const bars = await provider.fetchDailyBars(ref, from);
          const usable = bars.filter((bar) => isUsable(bar, now));
          if (usable.length === 0) throw new Error(`No usable bars for ${ref.symbol}`);
          return usable;
        },
      );

      if (outcome === null) {
        failed.push(id);
        consecutiveFailures += 1;
        continue;
      }

      for (const fellBackFrom of outcome.fallenBackFrom) {
        await deps.symbols.recordFallback(id, fellBackFrom);
      }

      await deps.prices.save(outcome.value, outcome.source);
      refreshed.push(id);
      consecutiveFailures = 0;
    }

    return { refreshed, unmapped, failed };
  };
}

/**
 * How many instruments one backfill round asks a provider for. A full
 * backfill is **one request per instrument, ever, per source** —
 * `fetchDailyBars` already returns an instrument's whole history in one call
 * — so this bounds how much provider time a single render's backfill round
 * can spend, not how much history it fetches. `callYahoo` (the adapter)
 * already throttles to roughly one request per second, so a full batch costs
 * a few seconds.
 */
export const BACKFILL_BATCH = 8;

/**
 * Fetched (not requested) a week before `from`, purely so `historyFor`'s
 * left-edge anchor always has a bar to carry forward from. Without this, a
 * `from` that lands on a session this instrument's own exchange had closed
 * (a holiday the caller's calendar-only window arithmetic doesn't know
 * about) leaves day one of the window permanently `partial`: `markCovered`
 * still — correctly — claims `from` itself, `notYetCovered` turns `false`,
 * and nothing ever asks again (CU-869ej7zk8, found live). The buffer costs
 * nothing extra — `fetchDailyBars` already returns the whole tail in one
 * request — and `coveredFrom` is still recorded at the real `from`, never at
 * the buffered one, so a narrower later window's due-check is unaffected.
 */
const ANCHOR_BUFFER_DAYS = 7;

/**
 * Backfills the daily history a chart needs, once per instrument for the
 * life of that instrument, **from its single primary history source** —
 * `primaryHistorySourceFor`, the same fixed choice `makeReadPriceHistory`
 * reads from. Deliberately does not use `fetchWithFallback`: a bar saved
 * under a fallback source here would be invisible to `historyFor`, which
 * never reads anything but the primary — a wasted write, not resilience.
 *
 * Guarded by `MarketPriceRepository`'s coverage table rather than by what
 * rows already exist: `instrument_prices`' `min(date)` can never distinguish
 * "nobody has asked for history before this" from "the provider has nothing
 * earlier", so without an explicit record of what was *asked for*, every
 * render of a wide chart would re-request the same unanswerable window
 * forever — the mistake that would actually risk a ban (CU-869ej7zk8).
 *
 * Bounded to `limit` instruments per call and reported via `remaining`, so a
 * caller with more instruments than one round can cover keeps making
 * progress across renders instead of blocking the first one on all of them.
 * Never called from the render path — same rule `makeRefreshPrices` follows.
 */
export function makeBackfillPriceHistory(deps: {
  prices: MarketPriceRepository;
  symbols: SymbolRepository;
  providers: ReadonlyMap<ProviderName, PriceProvider>;
  clock: Clock;
}) {
  return async function backfillPriceHistory(
    ids: readonly InstrumentId[],
    from: Temporal.PlainDate,
    limit: number = BACKFILL_BATCH,
  ): Promise<RefreshReport<InstrumentId> & { readonly remaining: number }> {
    const now = deps.clock.now();
    const chains = await deps.symbols.chainFor(ids);
    const primaryRefs = primaryHistorySourceFor(ids, chains, deps.providers);

    const coverage = new Map<InstrumentId, Temporal.PlainDate>();
    for (const [source, sourceIds] of groupBySource(primaryRefs)) {
      const rows = await deps.prices.coverageFor(sourceIds, source);
      for (const [id, coveredFrom] of rows) coverage.set(id, coveredFrom);
    }

    const due = ids.filter((id) => {
      const coveredFrom = coverage.get(id);
      return coveredFrom === undefined || Temporal.PlainDate.compare(coveredFrom, from) > 0;
    });
    const batch = due.slice(0, limit);

    const refreshed: InstrumentId[] = [];
    const unmapped: InstrumentId[] = [];
    const failed: InstrumentId[] = [];
    let consecutiveFailures = 0;
    let attempted = 0;

    for (const id of batch) {
      if (consecutiveFailures >= 2) break;
      attempted += 1;

      const ref = primaryRefs.get(id);
      if (ref === undefined) {
        unmapped.push(id);
        continue;
      }

      // `primaryHistorySourceFor` only returns entries whose provider is registered.
      const provider = deps.providers.get(ref.provider)!;
      try {
        const bars = await provider.fetchDailyBars(
          ref,
          from.subtract({ days: ANCHOR_BUFFER_DAYS }),
        );
        const usable = bars.filter((bar) => isUsable(bar, now));
        if (usable.length > 0) await deps.prices.save(usable, ref.provider);
        // Widened even on an empty response: a delisted or recently-listed
        // instrument must never be asked the same unanswerable question on
        // every future render. Only a thrown request below leaves coverage
        // unwritten, so a transient failure gets retried next round.
        await deps.prices.markCovered([id], ref.provider, from);
        refreshed.push(id);
        consecutiveFailures = 0;
      } catch {
        failed.push(id);
        consecutiveFailures += 1;
      }
    }

    return { refreshed, unmapped, failed, remaining: due.length - attempted };
  };
}

/**
 * Storage only, safe on the render path — the chart-history counterpart of
 * `makeReadPrices`. Every id reads from its single primary history source
 * (see `primaryHistorySourceFor`); an id with no history-capable provider is
 * simply absent from the result, same as `MarketPriceRepository.historyFor`
 * already treats "nothing in range".
 */
export function makeReadPriceHistory(deps: {
  prices: MarketPriceRepository;
  symbols: SymbolRepository;
  providers: ReadonlyMap<ProviderName, PriceProvider>;
}) {
  return async function readPriceHistory(
    ids: readonly InstrumentId[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    grain: SeriesGrain,
  ): Promise<ReadonlyMap<InstrumentId, readonly StoredBar[]>> {
    const chains = await deps.symbols.chainFor(ids);
    const primaryRefs = primaryHistorySourceFor(ids, chains, deps.providers);

    const result = new Map<InstrumentId, readonly StoredBar[]>();
    for (const [source, sourceIds] of groupBySource(primaryRefs)) {
      const rows = await deps.prices.historyFor(sourceIds, from, to, grain, source);
      for (const [id, bars] of rows) result.set(id, bars);
    }
    return result;
  };
}

/** `makeReadPriceHistory`'s counterpart for `MarketPriceRepository.coverageFor` — same source-per-id routing. */
export function makeReadPriceCoverage(deps: {
  prices: MarketPriceRepository;
  symbols: SymbolRepository;
  providers: ReadonlyMap<ProviderName, PriceProvider>;
}) {
  return async function readPriceCoverage(
    ids: readonly InstrumentId[],
  ): Promise<ReadonlyMap<InstrumentId, Temporal.PlainDate>> {
    const chains = await deps.symbols.chainFor(ids);
    const primaryRefs = primaryHistorySourceFor(ids, chains, deps.providers);

    const result = new Map<InstrumentId, Temporal.PlainDate>();
    for (const [source, sourceIds] of groupBySource(primaryRefs)) {
      const rows = await deps.prices.coverageFor(sourceIds, source);
      for (const [id, coveredFrom] of rows) result.set(id, coveredFrom);
    }
    return result;
  };
}
