import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currency } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  fetchGpwCorporateBondsList: vi.fn(),
  fetchGpwCatalystInstrumentPage: vi.fn(),
}));

import { fetchGpwCatalystInstrumentPage, fetchGpwCorporateBondsList } from './client';
import { gpwCatalystBondLookup } from './catalyst-bond-lookup';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf-8');

describe('gpwCatalystBondLookup.search', () => {
  it('pairs each ticker with the rowspan-grouped issuer that precedes it', async () => {
    vi.mocked(fetchGpwCorporateBondsList).mockResolvedValue(
      fixture('corporate-bonds-listing-sample.html'),
    );

    const candidates = await gpwCatalystBondLookup.search('best');

    expect(candidates).toEqual([
      { ticker: 'BFW1027', issuerName: 'BEST NIEST FIZ WIERZYTELNOŚCI' },
      { ticker: 'BST0730', issuerName: 'BEST' },
      { ticker: 'KRI0328', issuerName: 'BEST' },
    ]);
  });

  it('matches a ticker directly as well as the issuer name', async () => {
    vi.mocked(fetchGpwCorporateBondsList).mockResolvedValue(
      fixture('corporate-bonds-listing-sample.html'),
    );

    const candidates = await gpwCatalystBondLookup.search('KRI0328');

    expect(candidates).toEqual([{ ticker: 'KRI0328', issuerName: 'BEST' }]);
  });

  it('returns nothing for a query that matches no issuer or ticker', async () => {
    vi.mocked(fetchGpwCorporateBondsList).mockResolvedValue(
      fixture('corporate-bonds-listing-sample.html'),
    );

    expect(await gpwCatalystBondLookup.search('ghelamco')).toEqual([]);
  });
});

describe('gpwCatalystBondLookup.fetchListing', () => {
  it('parses ISIN, issuer name, and nominal from a real captured page', async () => {
    vi.mocked(fetchGpwCatalystInstrumentPage).mockResolvedValue(fixture('ghe0128.html'));

    const listing = await gpwCatalystBondLookup.fetchListing('GHE0128');

    expect(listing).not.toBeNull();
    expect(listing?.ticker).toBe('GHE0128');
    expect(listing?.isin).toBe('PLGHLMC00602');
    expect(listing?.issuerName).toBe('GHELAMCO INVEST');
    expect(listing?.nominal.amount.toFixed(2)).toBe('100.00');
    expect(listing?.nominal.currency).toBe(currency('PLN'));
  });

  it('returns null for a ticker the page does not recognise', async () => {
    vi.mocked(fetchGpwCatalystInstrumentPage).mockResolvedValue(fixture('nope9999.html'));

    expect(await gpwCatalystBondLookup.fetchListing('NOPE9999')).toBeNull();
  });
});
