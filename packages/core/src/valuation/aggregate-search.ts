import { type InstrumentSearchProvider } from './ports';
import { type ConfirmedCandidate, type InstrumentCandidate } from './types';

/**
 * Fans a search out to every registered `InstrumentSearchProvider` and
 * merges the hits; dispatches `confirm()` to whichever provider actually
 * produced the picked candidate, by its own `provider` field.
 *
 * `makeSearchInstruments` (`usecases/search-instruments.ts`) takes exactly
 * one `InstrumentSearchProvider` — this satisfies that same port rather
 * than widening it, the same choice ADR 0022 made for prices: routing
 * across several sources is composition over the existing port, not a new
 * one. Unlike `provider-chain.ts`'s fallback (first success wins, in
 * priority order), this always queries every provider and merges — a fund
 * bankier answers for and an ETF Yahoo answers for are both real results
 * for the same query, not alternatives for the same instrument.
 *
 * A provider that throws contributes zero results rather than failing the
 * whole search, same tolerance `fetchWithFallback` gives a failing price
 * provider — one source being down should never hide what the others found.
 */
export function makeAggregatingSearch(
  providers: readonly InstrumentSearchProvider[],
): InstrumentSearchProvider {
  const byName = new Map(providers.map((provider) => [provider.name, provider]));

  return {
    // Nothing reads `.name` on this port today (only `PriceProvider.name` is
    // used, for registry keying) — no single name would describe a fan-out
    // over several providers anyway, so the first one stands in.
    name: providers[0]?.name ?? 'yahoo',

    async search(query: string): Promise<readonly InstrumentCandidate[]> {
      const results = await Promise.all(
        providers.map(async (provider) => {
          try {
            return await provider.search(query);
          } catch {
            return [];
          }
        }),
      );
      return results.flat();
    },

    async confirm(candidate: InstrumentCandidate): Promise<ConfirmedCandidate | null> {
      const provider = byName.get(candidate.provider);
      if (provider === undefined) return null;
      return provider.confirm(candidate);
    },
  };
}
