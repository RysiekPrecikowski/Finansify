import { type InstrumentId } from '../ledger/types';
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
  type StoredBar,
  type StoredFxRate,
} from './types';
import { type ProviderName } from './vocabulary';

/**
 * Fetches bars for an instrument **already** resolved to this provider's
 * symbol. Section 06's ambiguity — one ISIN, several listings — is resolved
 * before this port is ever called; an adapter implementing this interface
 * cannot express "which listing did you mean", which is the point.
 */
export interface PriceProvider {
  readonly name: ProviderName;
  fetchDailyBars(ref: ResolvedSymbol, from: Temporal.PlainDate): Promise<readonly PriceBar[]>;
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

export interface MarketPriceRepository {
  latestFor(ids: readonly InstrumentId[]): Promise<ReadonlyMap<InstrumentId, StoredBar>>;
  save(bars: readonly PriceBar[], source: ProviderName): Promise<void>;
}

export interface SymbolRepository {
  resolvedFor(ids: readonly InstrumentId[]): Promise<ReadonlyMap<InstrumentId, ResolvedSymbol>>;
  save(ref: ResolvedSymbol): Promise<void>;
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
}
