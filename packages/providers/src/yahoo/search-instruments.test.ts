import { currency } from '@finansify/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  yahooFinance: { quote: vi.fn(), search: vi.fn() },
  callYahoo: (fn: () => Promise<unknown>) => fn(),
}));

import { yahooFinance } from './client';
import { yahooInstrumentSearch } from './search-instruments';

describe('yahooInstrumentSearch.search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps an EQUITY hit to a candidate with kind "equity" and currency null', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          symbol: 'AAPL',
          isYahooFinance: true,
          exchange: 'NMS',
          quoteType: 'EQUITY',
          longname: 'Apple Inc.',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('apple');

    expect(result).toEqual([
      {
        provider: 'yahoo',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NMS',
        currency: null,
        kind: 'equity',
        isin: null,
      },
    ]);
  });

  it('maps an ETF hit to kind "etf"', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          symbol: 'SXR8.DE',
          isYahooFinance: true,
          exchange: 'GER',
          quoteType: 'ETF',
          longname: 'iShares Core S&P 500 UCITS ETF',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('sp500');

    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('etf');
    expect(result[0]!.currency).toBeNull();
  });

  it('maps a MUTUALFUND hit to kind "fund"', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          symbol: 'VTSAX',
          isYahooFinance: true,
          exchange: 'NAS',
          quoteType: 'MUTUALFUND',
          longname: 'Vanguard Total Stock Market Index Fund',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('vanguard');

    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('fund');
    expect(result[0]!.currency).toBeNull();
  });

  it('filters out quote types this app has no vocabulary for', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        { symbol: '^GSPC', isYahooFinance: true, exchange: 'SNP', quoteType: 'INDEX' },
        { symbol: 'EURUSD=X', isYahooFinance: true, exchange: 'CCY', quoteType: 'CURRENCY' },
        { symbol: 'BTC-USD', isYahooFinance: true, exchange: 'CCC', quoteType: 'CRYPTOCURRENCY' },
        {
          symbol: 'AAPL240119C00150000',
          isYahooFinance: true,
          exchange: 'OPR',
          quoteType: 'OPTION',
        },
        {
          symbol: 'AAPL',
          isYahooFinance: true,
          exchange: 'NMS',
          quoteType: 'EQUITY',
          longname: 'Apple Inc.',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('apple');

    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('AAPL');
  });

  it('filters out non-Yahoo search hits, which lack quoteType entirely', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          index: 'crunchbase_1',
          name: 'Some Startup Inc.',
          permalink: 'some-startup',
          isYahooFinance: false,
        },
        {
          symbol: 'AAPL',
          isYahooFinance: true,
          exchange: 'NMS',
          quoteType: 'EQUITY',
          longname: 'Apple Inc.',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('apple');

    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('AAPL');
  });

  it('prefers longname over shortname for the candidate name', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          symbol: 'AAPL',
          isYahooFinance: true,
          exchange: 'NMS',
          quoteType: 'EQUITY',
          shortname: 'Apple',
          longname: 'Apple Inc.',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('apple');

    expect(result[0]!.name).toBe('Apple Inc.');
  });

  it('falls back to shortname when longname is absent', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          symbol: 'AAPL',
          isYahooFinance: true,
          exchange: 'NMS',
          quoteType: 'EQUITY',
          shortname: 'Apple',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('apple');

    expect(result[0]!.name).toBe('Apple');
  });

  it('falls back to the symbol when neither longname nor shortname is present', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({
      quotes: [
        {
          symbol: 'AAPL',
          isYahooFinance: true,
          exchange: 'NMS',
          quoteType: 'EQUITY',
        },
      ],
    } as never);

    const result = await yahooInstrumentSearch.search('apple');

    expect(result[0]!.name).toBe('AAPL');
  });
});

describe('yahooInstrumentSearch.confirm', () => {
  const candidate = {
    provider: 'yahoo' as const,
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NMS',
    currency: null,
    kind: 'equity' as const,
    isin: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a ConfirmedCandidate with currency and exchange refreshed from the quote', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      currency: 'USD',
      exchange: 'NMS',
      longName: 'Apple Inc.',
    } as never);

    const result = await yahooInstrumentSearch.confirm(candidate);

    expect(result).toEqual({
      ...candidate,
      name: 'Apple Inc.',
      exchange: 'NMS',
      currency: currency('USD'),
    });
    expect(yahooFinance.quote).toHaveBeenCalledWith('AAPL');
  });

  it('refreshes the name from the quote, preferring longName over shortName', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      currency: 'USD',
      exchange: 'NMS',
      shortName: 'Apple',
      longName: 'Apple Inc. (refreshed)',
    } as never);

    const result = await yahooInstrumentSearch.confirm(candidate);

    expect(result?.name).toBe('Apple Inc. (refreshed)');
  });

  it('returns null when quote() throws, e.g. a delisted or not-found symbol', async () => {
    vi.mocked(yahooFinance.quote).mockRejectedValue(new Error('Not Found'));

    const result = await yahooInstrumentSearch.confirm(candidate);

    expect(result).toBeNull();
  });

  it('returns null when the quote is missing currency', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      exchange: 'NMS',
    } as never);

    const result = await yahooInstrumentSearch.confirm(candidate);

    expect(result).toBeNull();
  });

  it('returns null when the quote is missing exchange', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      currency: 'USD',
    } as never);

    const result = await yahooInstrumentSearch.confirm(candidate);

    expect(result).toBeNull();
  });
});
