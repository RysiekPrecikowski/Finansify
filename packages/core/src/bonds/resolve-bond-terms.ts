import { type Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';
import { resolveFamilyRules } from './families';
import {
  type BondIssueParameterProvider,
  type BondIssueParameterRepository,
  type BondTermsResolver,
} from './ports';
import { parseSeriesCode } from './series-code';
import { type BondSeriesCode, type BondTerms } from './types';

/**
 * ADR 0011's cache-on-first-use resolver.
 *
 * Read the cache; on a miss, fetch once and write it back so every subsequent
 * holder of the series gets it for free. Then compose the cached per-issue
 * numbers with the family rules **in force on this holder's purchase date** —
 * which is why the cache stores parameters rather than composed terms, since
 * the early-redemption fee moved on 2024-09-01 and two holders of the same
 * series can legitimately face different fees.
 *
 * Returns `null` rather than throwing when the issue cannot be resolved: an
 * unresolvable series is a "this needs the manual override" answer, not a
 * crash, and the UI is where that gets surfaced.
 */
export function makeResolveBondTerms(deps: {
  readonly repository: BondIssueParameterRepository;
  readonly provider: BondIssueParameterProvider;
}): BondTermsResolver {
  const { repository, provider } = deps;

  return {
    async resolve(
      code: BondSeriesCode,
      purchasedOn: Temporal.PlainDate,
    ): Promise<BondTerms | null> {
      const { family } = parseSeriesCode(code);

      const cached = await repository.find([code]);
      const parameters = cached.get(code) ?? (await fetchAndCache(code));
      if (parameters === null) return null;

      return {
        seriesCode: code,
        rules: resolveFamilyRules(family, purchasedOn),
        firstPeriodRate: parameters.firstPeriodRate,
        margin: parameters.margin,
      };
    },
  };

  async function fetchAndCache(code: BondSeriesCode) {
    const fetched = await provider.fetchIssueParameters(code);
    if (fetched === null) return null;

    // Two users adding the same series at once race onto the same row; the
    // repository's upsert makes that harmless and the first write wins, so
    // there is no lock here on purpose (same reasoning as ADR 0014's prices).
    await repository.save(fetched, provider.name as ProviderName);
    return fetched;
  }
}
