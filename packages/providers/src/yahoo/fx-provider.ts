import {
  currency,
  Temporal,
  type FxQuote,
  type FxQuotePair,
  type FxQuoteProvider,
} from '@finansify/core';
import Decimal from 'decimal.js';

import { callYahoo, yahooFinance } from './client';

/**
 * Yahoo's symbol for a pair. `USDPLN=X` is PLN per USD, base first — the same
 * order `FxQuotePair` uses, so no leg ever gets swapped in translation.
 *
 * Yahoo also accepts the short `PLN=X` form for USD-based pairs. It is not used
 * here: the two forms resolve to the same instrument, and the explicit one
 * cannot silently become a different pair if the base ever changes.
 */
function symbolFor(pair: FxQuotePair): string {
  return `${pair.base}${pair.quote}=X`;
}

/**
 * Yahoo returns float32 artifacts — `USDPLN=X` came back as
 * `3.728559970855713` in testing. `priceHint` is the instrument's own decimal
 * precision, and rounding to it here is what keeps that noise from leaving this
 * package (rule 1, `packages/providers/CLAUDE.md`).
 *
 * A missing or nonsensical hint refuses the value rather than guessing a
 * default: `toDecimalPlaces(undefined)` rounds to nothing at all, which would
 * pass the artifact straight through, and a guessed precision is a made-up
 * rate. Four is not assumed — JPY pairs quote to two, and some crosses to six.
 */
function round(value: number, priceHint: number | undefined): Decimal {
  if (!Number.isInteger(priceHint) || priceHint === undefined || priceHint < 0) {
    throw new Error('Yahoo returned no usable priceHint for an FX quote');
  }
  return new Decimal(value).toDecimalPlaces(priceHint);
}

/**
 * Market FX, in contrast to NBP's daily fixing.
 *
 * Measured 2026-08-17: two `quote` calls twenty seconds apart returned 3.7105
 * and 3.71086 for `USDPLN=X`, with `exchangeDataDelayedBy: 0`. That is the
 * whole reason this adapter exists — no free source of a PLN pair updates
 * intraday except this one (`docs/data-sources.md`).
 *
 * What it is **not** is a valuation rate by default. ADR 0018 has the argument:
 * a market quote and the NBP mid disagree by 7-22 bps on a quiet day, and only
 * one of them is what a Polish tax return will use.
 */
export const yahooFxQuoteProvider: FxQuoteProvider = {
  name: 'yahoo',

  async fetchSpot(pair: FxQuotePair): Promise<FxQuote | null> {
    if (pair.base === pair.quote) return null;

    const result = await callYahoo(() => yahooFinance.quote(symbolFor(pair)));

    const rate = result?.regularMarketPrice;
    const at = result?.regularMarketTime;
    // Same gate as the price adapter: a JSON number is validated before it
    // becomes a `Decimal`, never coerced past a missing or nonsensical value.
    // A pair Yahoo does not quote comes back as "no rate", which the UI shows
    // as unavailable rather than as an error (rule 7).
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    if (at === undefined) return null;

    return {
      base: currency(pair.base),
      quote: currency(pair.quote),
      rate: round(rate, result?.priceHint),
      at: Temporal.Instant.fromEpochMilliseconds(new Date(at).getTime()),
    };
  },

  async fetchPairSeries(
    pair: FxQuotePair,
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
  ): Promise<readonly FxQuote[]> {
    if (pair.base === pair.quote) return [];
    if (Temporal.PlainDate.compare(from, to) > 0) {
      throw new Error(`Range starts after it ends: ${from.toString()}..${to.toString()}`);
    }

    const result = await callYahoo(() =>
      yahooFinance.chart(symbolFor(pair), {
        period1: from.toString(),
        period2: to.toString(),
        interval: '1d',
      }),
    );

    const base = currency(pair.base);
    const quote = currency(pair.quote);
    const priceHint = result.meta.priceHint;

    const quotes: FxQuote[] = [];
    for (const bar of result.quotes) {
      // Yahoo appends a **live partial bar** for the current day — an intraday
      // snapshot, not a close. Charting it mixes a settled series with a moving
      // one, so anything at or past `to` is dropped rather than shown as a
      // day's close it is not (ADR 0017).
      if (typeof bar.close !== 'number' || !Number.isFinite(bar.close) || bar.close <= 0) continue;

      const at = Temporal.Instant.fromEpochMilliseconds(bar.date.getTime());
      if (Temporal.PlainDate.compare(at.toZonedDateTimeISO('UTC').toPlainDate(), to) > 0) continue;

      quotes.push({ base, quote, rate: round(bar.close, priceHint), at });
    }

    return quotes;
  },
};
