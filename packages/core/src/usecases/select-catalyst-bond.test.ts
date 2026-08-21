import { describe, expect, it } from 'vitest';

import { type CatalystBondLookup, type CatalystBondTermsRepository } from '../bonds/ports';
import { type CatalystBondListing, type CatalystBondTerms } from '../bonds/types';
import { InMemoryInstruments } from '../ledger/in-memory-ledger';
import { currency, Money } from '../money';
import { InMemorySymbols } from '../valuation/in-memory-valuation';
import { makeSelectCatalystBond } from './select-catalyst-bond';

const PLN = currency('PLN');

const GHE0128: CatalystBondListing = {
  ticker: 'GHE0128',
  isin: 'PLGHLMC00602',
  issuerName: 'GHELAMCO INVEST',
  nominal: Money.of('100', PLN),
};

function fakeLookup(answer: CatalystBondListing | null): CatalystBondLookup {
  return {
    name: 'gpw',
    search: () => Promise.resolve([]),
    fetchListing: () => Promise.resolve(answer),
  };
}

function fakeCatalystBondTerms() {
  const rows = new Map<string, CatalystBondTerms>();
  const repository: CatalystBondTermsRepository = {
    find: (symbols) => {
      const found = new Map<string, CatalystBondTerms>();
      for (const symbol of symbols) {
        const row = rows.get(symbol);
        if (row !== undefined) found.set(symbol, row);
      }
      return Promise.resolve(found);
    },
    save: (terms) => {
      rows.set(terms.symbol, terms);
      return Promise.resolve();
    },
  };
  return { repository, rows };
}

describe('makeSelectCatalystBond', () => {
  it('creates the instrument keyed by ticker and maps gpw to the ISIN, not the ticker', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const { repository: catalystBondTerms } = fakeCatalystBondTerms();
    const selectCatalystBond = makeSelectCatalystBond({
      instruments,
      symbols,
      lookup: fakeLookup(GHE0128),
      catalystBondTerms,
    });

    const result = await selectCatalystBond({ ticker: 'GHE0128' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.symbol).toBe('GHE0128');
    expect(result.value.isin).toBe('PLGHLMC00602');
    expect(result.value.kind).toBe('catalyst_bond');

    const chain = (await symbols.chainFor([result.value.id])).get(result.value.id);
    expect(chain).toHaveLength(1);
    expect(chain?.[0]?.provider).toBe('gpw');
    // The critical fix: gpw's price lookups are keyed by ISIN, not the ticker.
    expect(chain?.[0]?.symbol).toBe('PLGHLMC00602');
  });

  it('warms the catalyst_bond_terms cache with the nominal it already fetched', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const { repository: catalystBondTerms, rows } = fakeCatalystBondTerms();
    const selectCatalystBond = makeSelectCatalystBond({
      instruments,
      symbols,
      lookup: fakeLookup(GHE0128),
      catalystBondTerms,
    });

    await selectCatalystBond({ ticker: 'GHE0128' });

    expect(rows.get('GHE0128')?.nominal.amount.toFixed(2)).toBe('100.00');
  });

  it('fails when the ticker does not resolve on Catalyst', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const { repository: catalystBondTerms } = fakeCatalystBondTerms();
    const selectCatalystBond = makeSelectCatalystBond({
      instruments,
      symbols,
      lookup: fakeLookup(null),
      catalystBondTerms,
    });

    const result = await selectCatalystBond({ ticker: 'NOPE9999' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues[0]?.path).toBe('ticker');
  });

  it('rejects a blank ticker before ever calling the lookup', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const { repository: catalystBondTerms } = fakeCatalystBondTerms();
    let called = false;
    const selectCatalystBond = makeSelectCatalystBond({
      instruments,
      symbols,
      lookup: {
        name: 'gpw',
        search: () => Promise.resolve([]),
        fetchListing: () => {
          called = true;
          return Promise.resolve(null);
        },
      },
      catalystBondTerms,
    });

    const result = await selectCatalystBond({ ticker: '   ' });

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
