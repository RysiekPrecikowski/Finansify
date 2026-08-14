import { type InstrumentRepository } from '../ledger/ports';
import { type Instrument } from '../ledger/types';
import { type InstrumentSearchProvider } from '../valuation/ports';
import { type InstrumentCandidate } from '../valuation/types';

export interface InstrumentSearchResult {
  /** Already in our own database — picking one needs no provider round trip, it's already resolvable. */
  readonly existing: readonly Instrument[];
  /** Only populated when `existing` is empty — see `makeSearchInstruments`. */
  readonly candidates: readonly InstrumentCandidate[];
}

const MIN_QUERY_LENGTH = 2;

/**
 * Local database first, the provider only as a fallback — the search behind
 * instrument selection everywhere in the app. Two instruments never come back
 * mixed: a hit in our own `instruments` table means every user before this one
 * already resolved it, so there is nothing a provider search would add except
 * an unnecessary request.
 */
export function makeSearchInstruments(deps: {
  instruments: InstrumentRepository;
  provider: InstrumentSearchProvider;
}) {
  return async function searchInstruments(rawQuery: string): Promise<InstrumentSearchResult> {
    const query = rawQuery.trim();
    if (query.length < MIN_QUERY_LENGTH) return { existing: [], candidates: [] };

    const existing = await deps.instruments.search(query);
    if (existing.length > 0) return { existing, candidates: [] };

    const candidates = await deps.provider.search(query);
    return { existing: [], candidates };
  };
}
