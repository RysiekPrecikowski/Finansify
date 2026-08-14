import {
  currency,
  type ConfirmedCandidate,
  type InstrumentCandidate,
  type InstrumentKind,
  type InstrumentSearchProvider,
} from '@finansify/core';

import { callYahoo, yahooFinance } from './client';

/**
 * The `quoteType`s this app can hold a position in, mapped onto our own
 * vocabulary. Everything else `search()` can return — `INDEX`, `CURRENCY`,
 * `CRYPTOCURRENCY`, `OPTION`, `FUTURE`, `MONEY_MARKET` — is filtered out
 * before it ever reaches a user: none of them are things `instruments.kind`
 * has a value for, and offering one as a selectable candidate would just
 * produce a `findOrCreate` with a made-up kind.
 */
const QUOTE_TYPE_TO_KIND: Readonly<Record<string, InstrumentKind>> = {
  EQUITY: 'equity',
  ETF: 'etf',
  MUTUALFUND: 'fund',
};

/**
 * The `InstrumentSearchProvider` behind typeahead selection (ADR 0014,
 * revised): `search()` surfaces real Yahoo listings — never a ticker this app
 * constructed from a MIC code — and `confirm()` re-fetches the one the user
 * picked to fill in `currency`, which a search hit never carries.
 */
export const yahooInstrumentSearch: InstrumentSearchProvider = {
  name: 'yahoo',

  async search(query: string): Promise<readonly InstrumentCandidate[]> {
    const result = await callYahoo(() =>
      yahooFinance.search(query, { quotesCount: 10, newsCount: 0 }),
    );

    const candidates: InstrumentCandidate[] = [];
    for (const quote of result.quotes) {
      if (!('isYahooFinance' in quote) || !quote.isYahooFinance) continue;
      if (!('quoteType' in quote)) continue;
      const kind = QUOTE_TYPE_TO_KIND[quote.quoteType];
      if (kind === undefined) continue;

      candidates.push({
        provider: 'yahoo',
        symbol: quote.symbol,
        name: quote.longname ?? quote.shortname ?? quote.symbol,
        exchange: quote.exchange,
        currency: null,
        kind,
        isin: null,
      });
    }
    return candidates;
  },

  async confirm(candidate: InstrumentCandidate): Promise<ConfirmedCandidate | null> {
    let quote: Awaited<ReturnType<typeof yahooFinance.quote>>;
    try {
      quote = await callYahoo(() => yahooFinance.quote(candidate.symbol));
    } catch {
      return null;
    }

    if (quote.currency === undefined || quote.exchange === undefined) return null;

    return {
      ...candidate,
      name: quote.longName ?? quote.shortName ?? candidate.name,
      exchange: quote.exchange,
      currency: currency(quote.currency),
    };
  },
};
