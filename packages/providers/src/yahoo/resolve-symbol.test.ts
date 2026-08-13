import { currency, instrumentId, type Instrument } from '@finansify/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  yahooFinance: { quote: vi.fn(), search: vi.fn() },
  callYahoo: (fn: () => Promise<unknown>) => fn(),
}));

import { yahooFinance } from './client';
import { yahooSymbolResolver } from './resolve-symbol';

const SXR8 = instrumentId('00000000-0000-4000-9000-000000000010');

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: SXR8,
    kind: 'etf',
    isin: 'IE00B5BMR087',
    symbol: 'SXR8',
    exchange: 'XETR',
    currency: currency('EUR'),
    name: 'iShares Core S&P 500',
    ...overrides,
  };
}

describe('yahooSymbolResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves to the candidate built from our own (symbol, exchange) when quote confirms currency and exchange', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({ quotes: [{ symbol: 'CSSPX.MI' }] } as never);
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      currency: 'EUR',
      exchange: 'GER',
    } as never);

    const result = await yahooSymbolResolver.resolve(instrument());

    expect(result).toEqual({
      instrumentId: SXR8,
      provider: 'yahoo',
      symbol: 'SXR8.DE',
      currency: currency('EUR'),
    });
    expect(yahooFinance.quote).toHaveBeenCalledWith('SXR8.DE');
  });

  it('refuses the mapping when quote currency does not match, even though ISIN search "confirmed" a different listing', async () => {
    // The regression this test exists for: search('IE00B5BMR087') returns
    // only the Milan listing, but our instrument is on the LSE in USD.
    vi.mocked(yahooFinance.search).mockResolvedValue({ quotes: [{ symbol: 'CSSPX.MI' }] } as never);
    vi.mocked(yahooFinance.quote).mockResolvedValue({ currency: 'USD', exchange: 'LSE' } as never);

    const result = await yahooSymbolResolver.resolve(
      instrument({ exchange: 'XLON', symbol: 'CSPX', currency: currency('EUR') }),
    );

    expect(result).toBeNull();
  });

  it('returns null when the instrument has no exchange', async () => {
    const result = await yahooSymbolResolver.resolve(instrument({ exchange: null }));
    expect(result).toBeNull();
    expect(yahooFinance.quote).not.toHaveBeenCalled();
  });

  it('returns null for an exchange with no Yahoo mapping', async () => {
    const result = await yahooSymbolResolver.resolve(instrument({ exchange: 'XTAI' }));
    expect(result).toBeNull();
    expect(yahooFinance.quote).not.toHaveBeenCalled();
  });

  it('returns null when quote() itself throws', async () => {
    vi.mocked(yahooFinance.search).mockResolvedValue({ quotes: [] } as never);
    vi.mocked(yahooFinance.quote).mockRejectedValue(new Error('Not Found'));

    const result = await yahooSymbolResolver.resolve(instrument());

    expect(result).toBeNull();
  });
});
