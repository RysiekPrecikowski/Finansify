import { currency, type InstrumentCandidate } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ fetchBankierFundChart: vi.fn() }));

import { fetchBankierFundChart } from './client';
import { bankierInstrumentSearch } from './search-instruments';

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

const PPK_SEARCH_RESPONSE = {
  funds_tfi: [{ kod: 'ALL91', nazwa_skrocona: 'Allianz Akcji Rynku Złota (Allianz FIO)' }],
  ppk: [{ code: 'CUN38', shortened_name: 'Allianz PPK 2065 (Allianz SFIO PPK)' }],
};

describe('bankierInstrumentSearch.search', () => {
  it('maps both funds_tfi and ppk hits to fund candidates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(PPK_SEARCH_RESPONSE)));

    const candidates = await bankierInstrumentSearch.search('allianz');

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ provider: 'bankier', symbol: 'ALL91', kind: 'fund' });
    expect(candidates[1]).toMatchObject({ provider: 'bankier', symbol: 'CUN38', kind: 'fund' });
    vi.unstubAllGlobals();
  });

  it('returns an empty list when neither array is present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));

    expect(await bankierInstrumentSearch.search('nope')).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('bankierInstrumentSearch.confirm', () => {
  const candidate: InstrumentCandidate = {
    provider: 'bankier',
    symbol: 'CUN38',
    name: 'submitted name',
    exchange: null,
    currency: null,
    kind: 'fund',
    isin: null,
  };

  it('answers from a re-verified exact match, not from the candidate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(PPK_SEARCH_RESPONSE))
      .mockImplementation(() => {
        throw new Error('unexpected fetch call');
      });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(fetchBankierFundChart).mockResolvedValue({
      parameters: { symbol: 'CUN38', range: '1m' },
      data: [{ data: [], profile_data: { currency: 'PLN' } }],
    });

    const confirmed = await bankierInstrumentSearch.confirm(candidate);

    expect(confirmed).not.toBeNull();
    expect(confirmed?.name).toBe('Allianz PPK 2065 (Allianz SFIO PPK)');
    expect(confirmed?.currency).toBe(currency('PLN'));
    expect(confirmed?.kind).toBe('fund');
    vi.unstubAllGlobals();
  });

  it('refuses when the re-search finds no exact kod/code match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ funds_tfi: [], ppk: [] })));

    expect(await bankierInstrumentSearch.confirm(candidate)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('refuses when the chart data has no currency to confirm with', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(PPK_SEARCH_RESPONSE)));
    vi.mocked(fetchBankierFundChart).mockResolvedValue({
      parameters: { symbol: 'CUN38', range: '1m' },
      data: [{ data: [], profile_data: {} }],
    });

    expect(await bankierInstrumentSearch.confirm(candidate)).toBeNull();
    vi.unstubAllGlobals();
  });
});
