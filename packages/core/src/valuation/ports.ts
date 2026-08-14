import { type InstrumentId, type Instrument } from '../ledger/types';
import { type Currency } from '../money';
import { type Temporal } from '../time';
import {
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
   * Re-fetches the live listing for a candidate the user just picked, and
   * refuses (`null`) if currency or exchange no longer match what `search`
   * returned. This is the hard gate ADR 0014 describes — moved to confirm a
   * real candidate instead of verifying a guessed one, but the same rule:
   * nothing is persisted without it succeeding.
   */
  confirm(candidate: InstrumentCandidate): Promise<InstrumentCandidate | null>;
}

/**
 * Phase 1's original resolver shape — given our own instrument record, decide
 * which provider symbol it is, or refuse. Kept only until PR 6 rewires
 * `apps/web`'s transaction form onto `InstrumentSearchProvider` above and
 * deletes this alongside `map-instrument.ts` and `resolve-instrument.ts`;
 * nothing new should be built against it.
 */
export interface SymbolResolver {
  readonly name: ProviderName;
  resolve(instrument: Instrument): Promise<ResolvedSymbol | null>;
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
}

export interface FxRateRepository {
  latestFor(currencies: readonly Currency[]): Promise<ReadonlyMap<Currency, StoredFxRate>>;
  save(rates: readonly FxRate[], source: ProviderName): Promise<void>;
}
