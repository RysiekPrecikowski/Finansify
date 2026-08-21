import { type InstrumentId, type InstrumentKind } from '../ledger/types';
import { type Currency } from '../money';
import { type Temporal } from '../time';
import { type FxQuotePair } from './fx-source';
import {
  type ConfirmedCandidate,
  type FxQuote,
  type FxRate,
  type InstrumentCandidate,
  type PriceBar,
  type ResolvedSymbol,
  type SeriesGrain,
  type StoredBar,
  type StoredFxRate,
} from './types';
import { type ProviderName } from './vocabulary';

/** What a provider can answer for one kind of instrument — never a global yes/no (ADR 0022). */
export interface ProviderCapabilities {
  readonly history: boolean;
  readonly spot: boolean;
}

/**
 * Fetches bars for an instrument **already** resolved to this provider's
 * symbol. Section 06's ambiguity — one ISIN, several listings — is resolved
 * before this port is ever called; an adapter implementing this interface
 * cannot express "which listing did you mean", which is the point.
 *
 * `capabilitiesFor` is keyed by `InstrumentKind`, not global: bankier has full
 * history for a PPK fund and only today's price for an equity, so "can this
 * provider serve this instrument" is a per-kind question (ADR 0022). Routing
 * must check `capabilitiesFor(kind).history` before ever calling
 * `fetchDailyBars`, and `.spot` before `fetchSpot`.
 */
export interface PriceProvider {
  readonly name: ProviderName;
  readonly capabilitiesFor: (kind: InstrumentKind) => ProviderCapabilities;
  fetchDailyBars(ref: ResolvedSymbol, from: Temporal.PlainDate): Promise<readonly PriceBar[]>;
  /** Only called when `capabilitiesFor(kind).spot` is true. Absent entirely for a provider with no separate spot fetch. */
  fetchSpot?(ref: ResolvedSymbol): Promise<PriceBar | null>;
}

/**
 * Search-as-you-type, local database first. `search-instruments` (usecase)
 * tries `InstrumentRepository.search` before ever calling this — an instrument
 * already resolved by one user should never trigger a second Yahoo request for
 * the next one who types the same ticker.
 */
export interface InstrumentSearchProvider {
  readonly name: ProviderName;
  search(query: string): Promise<readonly InstrumentCandidate[]>;

  /**
   * Re-fetches the live listing for a candidate the user just picked — by its
   * own `symbol`, not a guess built from one — and fills in `currency`
   * (absent from a search hit). Refuses (`null`) if the symbol no longer
   * resolves to anything tradeable. This is the hard gate ADR 0014 describes:
   * nothing is persisted without it succeeding.
   */
  confirm(candidate: InstrumentCandidate): Promise<ConfirmedCandidate | null>;
}

/**
 * Every read names its source — same reasoning as `FxRateRepository` (ADR
 * 0018) and the same key shape (ADR 0022): two providers can hold a price for
 * the same instrument-day and disagree, so a query that omits a source is a
 * question with two correct answers. Callers that need "whichever source has
 * it" batch ids by their chain's chosen source and call once per source; see
 * `get-prices.ts`.
 */
export interface MarketPriceRepository {
  latestFor(
    ids: readonly InstrumentId[],
    source: ProviderName,
  ): Promise<ReadonlyMap<InstrumentId, StoredBar>>;
  save(bars: readonly PriceBar[], source: ProviderName): Promise<void>;

  /**
   * The bucketed history a chart actually renders: the last close in each
   * `grain` bucket between `from` and `to`, **plus one anchor bar strictly
   * before `from`** (prepended, oldest first) so a caller can carry a price
   * forward across the left edge of the window instead of showing a gap on
   * day one. A day with no close at all for an id is simply absent — never
   * padded (rule 7). Ascending per id.
   */
  historyFor(
    ids: readonly InstrumentId[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    grain: SeriesGrain,
    source: ProviderName,
  ): Promise<ReadonlyMap<InstrumentId, readonly StoredBar[]>>;

  /**
   * How far back a backfill has already asked this source for each id — the
   * ban-avoidance mechanism CU-869ej7zk8 depends on. An id absent from the
   * result has never been asked at all.
   */
  coverageFor(
    ids: readonly InstrumentId[],
    source: ProviderName,
  ): Promise<ReadonlyMap<InstrumentId, Temporal.PlainDate>>;

  /**
   * Records that history from `from` onward has been requested for `ids`,
   * **even when the provider returned nothing** — a delisted or
   * recently-listed instrument must never be asked the same unanswerable
   * question on every render. Widens only: implementations must take the
   * earliest of the stored and the new `from`, never overwrite a wider
   * coverage with a narrower one.
   */
  markCovered(
    ids: readonly InstrumentId[],
    source: ProviderName,
    from: Temporal.PlainDate,
  ): Promise<void>;
}

export interface SymbolRepository {
  /** The first (lowest-priority) entry of `chainFor` per instrument — kept for callers that only ever want one. */
  resolvedFor(ids: readonly InstrumentId[]): Promise<ReadonlyMap<InstrumentId, ResolvedSymbol>>;

  /**
   * Every provider mapping for an instrument, ordered lowest-`priority`
   * first — the whole fallback chain `provider-chain.ts` routes over. An
   * instrument absent from the result has no mapping at all.
   */
  chainFor(
    ids: readonly InstrumentId[],
  ): Promise<ReadonlyMap<InstrumentId, readonly ResolvedSymbol[]>>;

  save(ref: ResolvedSymbol): Promise<void>;

  /**
   * Records that `provider` was tried for `instrumentId` and failed this
   * round — an admin-visible counter, not a mechanism: fallback is
   * deliberately non-sticky (ADR 0022), so this never reorders the chain
   * itself.
   */
  recordFallback(instrumentId: InstrumentId, provider: ProviderName): Promise<void>;
}

/** Rates to PLN; cross rates are computed by `core` (`convertViaPln`), never stored. */
export interface FxRateProvider {
  readonly name: ProviderName;
  fetchTableTo(base: Currency): Promise<readonly FxRate[]>;

  /**
   * One currency's history over a date range, for charting a pair. Business
   * days only — a range containing no publication comes back empty, never
   * padded, and the adapter owns whatever per-request range limit its upstream
   * imposes.
   */
  fetchSeriesTo(
    code: Currency,
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
  ): Promise<readonly FxRate[]>;
}

/**
 * A market FX feed, which speaks **pairs** rather than a PLN-based table.
 *
 * Deliberately a second port rather than another `FxRateProvider`: NBP
 * publishes one table against PLN and derives every cross from it, while Yahoo
 * quotes `EUR/USD` as its own instrument and has no table at all. Forcing one
 * interface over both would mean a `fetchTableTo` on Yahoo that fans out into
 * thirty-odd requests to answer a question nobody asked.
 */
export interface FxQuoteProvider {
  readonly name: ProviderName;

  /** The rate right now, and the instant it was quoted at. */
  fetchSpot(pair: FxQuotePair): Promise<FxQuote | null>;

  /**
   * Daily closes for one pair. Unlike the NBP archive this needs no chunking —
   * one request returns the whole window — and it does include weekend gaps in
   * the same shape: a day with no close is absent, never filled.
   */
  fetchPairSeries(
    pair: FxQuotePair,
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
  ): Promise<readonly FxQuote[]>;
}

/**
 * Every read names its source. `fx_rates` is keyed by it (ADR 0018) because two
 * feeds hold a rate for the same currency-day and disagree, so a query that
 * omits it is a question with two correct answers.
 */
export interface FxRateRepository {
  latestFor(
    currencies: readonly Currency[],
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, StoredFxRate>>;
  /** Oldest first per currency; a currency with no rows in the range is absent from the map. */
  seriesFor(
    currencies: readonly Currency[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, readonly StoredFxRate[]>>;
  save(rates: readonly FxRate[], source: ProviderName): Promise<void>;

  /**
   * `seriesFor`'s bucketed counterpart, with the same left-edge anchor
   * `MarketPriceRepository.historyFor` prepends — see that doc comment.
   * `seriesFor` itself is untouched: `/indicators` and the FX pair card
   * depend on its current range-only, unanchored shape.
   */
  historyFor(
    currencies: readonly Currency[],
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
    grain: SeriesGrain,
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, readonly StoredFxRate[]>>;

  coverageFor(
    currencies: readonly Currency[],
    source: ProviderName,
  ): Promise<ReadonlyMap<Currency, Temporal.PlainDate>>;

  /** Widens only — same contract as `MarketPriceRepository.markCovered`. */
  markCovered(
    currencies: readonly Currency[],
    source: ProviderName,
    from: Temporal.PlainDate,
  ): Promise<void>;
}
