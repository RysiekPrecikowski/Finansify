import { type InstrumentId, type Instrument } from '../ledger/types';
import { type Currency } from '../money';
import { type Temporal } from '../time';
import {
  type FxRate,
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
 * Given our own instrument record, decide which provider symbol it is — or
 * refuse. A `null` result means "needs a human", not "retry me": the
 * disambiguation in section 06 (MIC first, ISIN as cross-check only, currency
 * and exchange as the hard gate) lives inside the implementation, because only
 * the provider adapter knows its own listing conventions.
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

/** Kursy do PLN; cross rates are computed by `core` (`convertViaPln`), never stored. */
export interface FxRateProvider {
  readonly name: ProviderName;
  fetchTableTo(base: Currency): Promise<readonly FxRate[]>;
}

export interface FxRateRepository {
  latestFor(currencies: readonly Currency[]): Promise<ReadonlyMap<Currency, StoredFxRate>>;
  save(rates: readonly FxRate[], source: ProviderName): Promise<void>;
}
