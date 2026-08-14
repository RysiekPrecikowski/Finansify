import { type Instrument, type ResolvedSymbol, type SymbolResolver } from '@finansify/core';

import { callYahoo, yahooFinance } from './client';
import { MIC_TO_YAHOO } from './mic-suffix';

/**
 * Section 06's algorithm, corrected from the plan's first draft: ISIN does
 * **not** disambiguate a listing (`search('IE00B5BMR087')` returns exactly
 * one hit — Milan — even though the same ISIN also trades on XETRA and the
 * LSE, in a different currency). Exchange is the mandatory coordinate and
 * the primary candidate; ISIN is a soft cross-check that only logs; currency
 * and `quote().exchange` are the one hard gate a mismatch refuses.
 */
export const yahooSymbolResolver: SymbolResolver = {
  name: 'yahoo',

  async resolve(instrument: Instrument): Promise<ResolvedSymbol | null> {
    if (instrument.exchange === null) return null;

    const mapping = MIC_TO_YAHOO[instrument.exchange];
    if (mapping === undefined) return null;

    const candidate = `${instrument.symbol}${mapping.suffix}`;

    if (instrument.isin !== null) {
      await crossCheckIsin(instrument.isin, candidate);
    }

    let quote: Awaited<ReturnType<typeof yahooFinance.quote>>;
    try {
      quote = await callYahoo(() => yahooFinance.quote(candidate));
    } catch {
      return null;
    }

    if (quote.currency !== instrument.currency || quote.exchange !== mapping.code) {
      console.warn(
        `Refusing to map ${instrument.symbol}/${instrument.exchange} to ${candidate}: ` +
          `expected ${instrument.currency}/${mapping.code}, got ${quote.currency ?? '?'}/${quote.exchange}`,
      );
      return null;
    }

    return {
      instrumentId: instrument.id,
      provider: 'yahoo',
      symbol: candidate,
      currency: instrument.currency,
    };
  },
};

/**
 * Logs a mismatch and nothing more — Yahoo never returns an ISIN back out of
 * `quoteSummary`, so there is no way to close this loop with certainty, and a
 * failed or inconclusive search must never block a mapping the exchange/
 * currency gate already accepted.
 */
async function crossCheckIsin(isin: string, candidate: string): Promise<void> {
  try {
    const found = await callYahoo(() =>
      yahooFinance.search(isin, { quotesCount: 10, newsCount: 0 }),
    );
    const symbols = (found.quotes ?? [])
      .map((quote) => ('symbol' in quote ? quote.symbol : undefined))
      .filter((symbol): symbol is string => typeof symbol === 'string');

    if (!symbols.includes(candidate)) {
      console.warn(
        `ISIN ${isin} search returned [${symbols.join(', ')}], not our candidate ${candidate} — ` +
          `proceeding on the exchange/currency gate alone (ISIN is a cross-check, not a key)`,
      );
    }
  } catch {
    // A search failure is not a resolution failure.
  }
}
