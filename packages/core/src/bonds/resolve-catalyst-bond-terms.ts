import { type ProviderName } from '../valuation/vocabulary';
import {
  type CatalystBondTermsProvider,
  type CatalystBondTermsRepository,
  type CatalystBondTermsResolver,
} from './ports';
import { type CatalystBondTerms } from './types';

/**
 * ADR 0011's cache-on-first-use pattern, applied to Catalyst nominal values.
 *
 * Simpler than `makeResolveBondTerms`: a Catalyst issue's nominal is fixed for
 * its life and carries no purchase-date-dependent composition, so a cache hit
 * is the answer itself rather than a raw parameter still waiting to be
 * composed with family rules.
 */
export function makeResolveCatalystBondTerms(deps: {
  readonly repository: CatalystBondTermsRepository;
  readonly provider: CatalystBondTermsProvider;
}): CatalystBondTermsResolver {
  const { repository, provider } = deps;

  return {
    async resolve(symbol: string): Promise<CatalystBondTerms | null> {
      const cached = await repository.find([symbol]);
      const found = cached.get(symbol);
      if (found !== undefined) return found;

      const fetched = await provider.fetchTerms(symbol);
      if (fetched === null) return null;

      // Two users adding the same bond at once race onto the same row; the
      // repository's upsert makes that harmless and the first write wins, so
      // there is no lock here on purpose (same reasoning as ADR 0014's prices).
      await repository.save(fetched, provider.name as ProviderName);
      return fetched;
    },
  };
}
