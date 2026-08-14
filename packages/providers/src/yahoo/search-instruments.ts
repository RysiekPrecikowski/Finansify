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

  /**
   * The hard gate ADR 0014 describes, in the shape this flow needs. A search
   * hit carries no currency, so `confirm()` has to fetch the listing — and
   * everything it returns is taken from that fetch rather than from the
   * candidate, because a candidate rebuilt from a form is whatever the client
   * sent. A mismatch refuses the selection; it never guesses and never
   * half-trusts.
   */
  async confirm(candidate: InstrumentCandidate): Promise<ConfirmedCandidate | null> {
    let quote: Awaited<ReturnType<typeof yahooFinance.quote>>;
    try {
      quote = await callYahoo(() => yahooFinance.quote(candidate.symbol));
    } catch {
      return null;
    }

    // `quote()` is typed as always returning a `Quote`, but it filters out
    // `quoteType === 'NONE'` and returns `results[0]` — so an unknown symbol,
    // or one delisted between search and submit, yields `undefined`. Every
    // check below dereferences it, and this runs on a value the client
    // supplied: without this guard a made-up symbol is a `TypeError` out of
    // the server action rather than "could not confirm".
    if (quote === undefined || quote === null) return null;

    // Yahoo answers a symbol it has normalized or repointed without saying so.
    // Without this, a selection could be persisted under the symbol that was
    // picked but with another listing's currency and exchange — the
    // wrong-listing valuation ADR 0014 exists to prevent, and the one the
    // deleted `resolve-symbol.ts` refused by comparing against our own record.
    if (quote.symbol !== candidate.symbol) return null;

    if (quote.currency === undefined || quote.exchange === undefined) return null;

    // Re-derived, never carried over: `QUOTE_TYPE_TO_KIND` gates what `search()`
    // offers, so it only gates what a user can *see*. A selection arrives as
    // form fields, so an index or an FX pair — both of which have a currency
    // and an exchange, and so would otherwise confirm cleanly — reaches the
    // global `instruments` table with whatever kind was submitted.
    const kind = QUOTE_TYPE_TO_KIND[quote.quoteType];
    if (kind === undefined) return null;

    return {
      provider: candidate.provider,
      symbol: quote.symbol,
      // The symbol, not `candidate.name`, as the last resort: a client-supplied
      // name would otherwise be written to the global `instruments` row and
      // never corrected by `findOrCreate` — permanent name spoofing served to
      // every user. Nothing descriptive comes from the candidate.
      name: quote.longName ?? quote.shortName ?? quote.symbol,
      exchange: quote.exchange,
      currency: currency(quote.currency),
      kind,
      // Neither `search()` nor `quote()` returns one, and ADR 0014 demoted ISIN
      // to a soft cross-check. Carrying the candidate's through would only
      // propagate whatever the client sent.
      isin: null,
    };
  },
};
