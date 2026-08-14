import { currency, type InstrumentCandidate } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  yahooFinance: { search: vi.fn(), quote: vi.fn() },
  callYahoo: (fn: () => Promise<unknown>) => fn(),
}));

import { yahooFinance } from './client';
import { yahooInstrumentSearch } from './search-instruments';

/** What `select-instrument` hands over: which listing, and nothing else. */
const selection: InstrumentCandidate = {
  provider: 'yahoo',
  symbol: 'IWDA.AS',
  name: 'submitted name',
  exchange: null,
  currency: null,
  kind: null,
  isin: null,
};

describe('yahooInstrumentSearch.confirm', () => {
  it('answers from the quote, not from the candidate', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: 'IWDA.AS',
      quoteType: 'ETF',
      currency: 'EUR',
      exchange: 'AMS',
      longName: 'iShares Core MSCI World UCITS ETF',
    } as never);

    const confirmed = await yahooInstrumentSearch.confirm(selection);

    expect(confirmed).not.toBeNull();
    expect(confirmed?.kind).toBe('etf');
    expect(confirmed?.currency).toBe(currency('EUR'));
    expect(confirmed?.exchange).toBe('AMS');
    expect(confirmed?.name).toBe('iShares Core MSCI World UCITS ETF');
    expect(confirmed?.isin).toBeNull();
  });

  it('refuses when the quote is for a different listing than the one picked', async () => {
    // Yahoo normalizing or repointing the symbol. Accepting this would marry
    // the picked symbol to another listing's currency — ADR 0014's wrong
    // listing, reached without anyone typing anything unusual.
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: 'IWDA.L',
      quoteType: 'ETF',
      currency: 'USD',
      exchange: 'LSE',
    } as never);

    expect(await yahooInstrumentSearch.confirm(selection)).toBeNull();
  });

  it('refuses a quoteType this app cannot hold a position in', async () => {
    // `^GSPC` submitted as an equity: an index has both a currency and an
    // exchange, so presence checks alone would confirm it and write it into
    // the global instruments table.
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: '^GSPC',
      quoteType: 'INDEX',
      currency: 'USD',
      exchange: 'SNP',
    } as never);

    const confirmed = await yahooInstrumentSearch.confirm({
      ...selection,
      symbol: '^GSPC',
      kind: 'equity',
    });

    expect(confirmed).toBeNull();
  });

  it('refuses an FX pair the same way', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: 'EURPLN=X',
      quoteType: 'CURRENCY',
      currency: 'PLN',
      exchange: 'CCY',
    } as never);

    expect(
      await yahooInstrumentSearch.confirm({ ...selection, symbol: 'EURPLN=X', kind: 'equity' }),
    ).toBeNull();
  });

  it('refuses when the quote carries no currency or no exchange', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: 'IWDA.AS',
      quoteType: 'ETF',
      exchange: 'AMS',
    } as never);
    expect(await yahooInstrumentSearch.confirm(selection)).toBeNull();

    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: 'IWDA.AS',
      quoteType: 'ETF',
      currency: 'EUR',
    } as never);
    expect(await yahooInstrumentSearch.confirm(selection)).toBeNull();
  });

  it('refuses when the quote call itself fails', async () => {
    vi.mocked(yahooFinance.quote).mockRejectedValue(new Error('upstream down'));

    expect(await yahooInstrumentSearch.confirm(selection)).toBeNull();
  });

  it('refuses when the symbol is unknown and quote() resolves undefined', async () => {
    // yahoo-finance2 filters `quoteType: 'NONE'` and returns results[0], so an
    // unknown or delisted symbol resolves undefined rather than throwing.
    vi.mocked(yahooFinance.quote).mockResolvedValue(undefined as never);

    expect(await yahooInstrumentSearch.confirm({ ...selection, symbol: 'ZZZZZ' })).toBeNull();
  });

  it('falls back to the quote symbol, never the submitted name', async () => {
    vi.mocked(yahooFinance.quote).mockResolvedValue({
      symbol: 'IWDA.AS',
      quoteType: 'ETF',
      currency: 'EUR',
      exchange: 'AMS',
    } as never);

    const confirmed = await yahooInstrumentSearch.confirm(selection);

    expect(confirmed?.name).toBe('IWDA.AS');
  });
});
