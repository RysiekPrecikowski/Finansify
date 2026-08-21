import { describe, expect, it } from 'vitest';

import { makeAggregatingSearch } from './aggregate-search';
import { type InstrumentSearchProvider } from './ports';
import { type ConfirmedCandidate, type InstrumentCandidate } from './types';
import { currency } from '../money';

function providerNamed(
  name: 'yahoo' | 'bankier' | 'gpw',
  hits: readonly InstrumentCandidate[],
  options: { failSearch?: boolean } = {},
): InstrumentSearchProvider {
  return {
    name,
    search: () => {
      if (options.failSearch === true) throw new Error(`${name} is down`);
      return Promise.resolve(hits);
    },
    confirm: (candidate) =>
      Promise.resolve({
        ...candidate,
        currency: currency('PLN'),
        kind: candidate.kind ?? 'fund',
      } satisfies ConfirmedCandidate),
  };
}

const YAHOO_HIT: InstrumentCandidate = {
  provider: 'yahoo',
  symbol: 'IWDA.AS',
  name: 'iShares Core MSCI World',
  exchange: 'AMS',
  currency: null,
  kind: 'etf',
  isin: null,
};

const BANKIER_HIT: InstrumentCandidate = {
  provider: 'bankier',
  symbol: 'CUN38',
  name: 'Allianz PPK 2065',
  exchange: null,
  currency: null,
  kind: 'fund',
  isin: null,
};

describe('makeAggregatingSearch', () => {
  it('merges hits from every provider', async () => {
    const search = makeAggregatingSearch([
      providerNamed('yahoo', [YAHOO_HIT]),
      providerNamed('bankier', [BANKIER_HIT]),
    ]);

    const candidates = await search.search('anything');

    expect(candidates).toEqual([YAHOO_HIT, BANKIER_HIT]);
  });

  it('treats a failing provider as zero results from it, not a whole-search failure', async () => {
    const search = makeAggregatingSearch([
      providerNamed('yahoo', [], { failSearch: true }),
      providerNamed('bankier', [BANKIER_HIT]),
    ]);

    expect(await search.search('anything')).toEqual([BANKIER_HIT]);
  });

  it('dispatches confirm() to the provider named on the candidate', async () => {
    const search = makeAggregatingSearch([
      providerNamed('yahoo', [YAHOO_HIT]),
      providerNamed('bankier', [BANKIER_HIT]),
    ]);

    const confirmed = await search.confirm(BANKIER_HIT);

    expect(confirmed?.symbol).toBe('CUN38');
    expect(confirmed?.kind).toBe('fund');
  });

  it('refuses to confirm a candidate naming a provider that was never registered', async () => {
    const search = makeAggregatingSearch([providerNamed('yahoo', [YAHOO_HIT])]);

    expect(await search.confirm(BANKIER_HIT)).toBeNull();
  });
});
