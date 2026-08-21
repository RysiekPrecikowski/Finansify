import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { makeResolveCatalystBondTerms } from './resolve-catalyst-bond-terms';
import { type CatalystBondTermsProvider, type CatalystBondTermsRepository } from './ports';
import { type CatalystBondTerms } from './types';

const PLN = currency('PLN');

/** In-memory fakes of the ports — no database, no network (`packages/core/CLAUDE.md`). */
function fakeRepository(seed: CatalystBondTerms[] = []) {
  const rows = new Map(seed.map((t) => [t.symbol, t]));
  const saves: CatalystBondTerms[] = [];
  const repository: CatalystBondTermsRepository = {
    async find(symbols) {
      const found = new Map<string, CatalystBondTerms>();
      for (const symbol of symbols) {
        const row = rows.get(symbol);
        if (row !== undefined) found.set(symbol, row);
      }
      return found;
    },
    async save(terms) {
      saves.push(terms);
      rows.set(terms.symbol, terms);
    },
  };
  return { repository, saves };
}

function fakeProvider(answer: CatalystBondTerms | null) {
  const calls: string[] = [];
  const provider: CatalystBondTermsProvider = {
    name: 'gpw',
    async fetchTerms(symbol) {
      calls.push(symbol);
      return answer;
    },
  };
  return { provider, calls };
}

const ghe: CatalystBondTerms = { symbol: 'GHE0128', nominal: Money.of('100', PLN) };

describe('makeResolveCatalystBondTerms', () => {
  it('serves a cached symbol without touching the provider', async () => {
    const { repository } = fakeRepository([ghe]);
    const { provider, calls } = fakeProvider(null);

    const terms = await makeResolveCatalystBondTerms({ repository, provider }).resolve('GHE0128');

    expect(terms?.nominal.amount.toFixed(2)).toBe('100.00');
    expect(calls, 'a cache hit must not hit the network').toEqual([]);
  });

  it('fetches once on a miss and writes it back for everyone else', async () => {
    const { repository, saves } = fakeRepository();
    const { provider, calls } = fakeProvider(ghe);
    const resolver = makeResolveCatalystBondTerms({ repository, provider });

    await resolver.resolve('GHE0128');
    await resolver.resolve('GHE0128');

    expect(calls).toHaveLength(1);
    expect(saves).toHaveLength(1);
  });

  it('returns null when the symbol cannot be resolved, and caches nothing', async () => {
    const { repository, saves } = fakeRepository();
    const { provider } = fakeProvider(null);

    const terms = await makeResolveCatalystBondTerms({ repository, provider }).resolve('NOPE');

    expect(terms).toBeNull();
    expect(saves, 'an unresolved symbol must not poison the shared cache').toEqual([]);
  });
});
