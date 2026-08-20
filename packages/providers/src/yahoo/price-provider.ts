import {
  Money,
  Temporal,
  type PriceBar,
  type PriceProvider,
  type ResolvedSymbol,
} from '@finansify/core';
import Decimal from 'decimal.js';

import { callYahoo, yahooFinance } from './client';

/**
 * The widest gap between two consecutive trading sessions that a real
 * market calendar produces — a long weekend stacked on a public holiday.
 * Anything wider than this inside (or at the leading edge of) a response is
 * not a calendar gap, it's a sign the response itself is short.
 */
const MAX_TRADING_GAP_DAYS = 20;

export const yahooPriceProvider: PriceProvider = {
  name: 'yahoo',

  /**
   * `from` is already a several-day-wide window (`core`'s `refreshPrices`
   * picks it) rather than a single target day — the same request costs the
   * same either way, and the width absorbs weekends and holidays for free
   * (section 08).
   */
  async fetchDailyBars(
    ref: ResolvedSymbol,
    from: Temporal.PlainDate,
  ): Promise<readonly PriceBar[]> {
    const result = await callYahoo(() =>
      yahooFinance.chart(ref.symbol, { period1: from.toString(), interval: '1d' }),
    );

    const zone = result.meta.exchangeTimezoneName;
    const priceHint = result.meta.priceHint;
    // LSE pence-denominated instruments report `meta.currency === 'GBp'`
    // (same raw string `quote.currency` carries in resolve-symbol.ts). We
    // store `ref.currency: 'GBP'` for these, so divide by 100 after rounding
    // to `priceHint` — priceHint describes pence-scale precision here, and
    // re-rounding after dividing would reintroduce the precision loss it
    // exists to prevent. An exact unit conversion, not an estimate.
    const isPence = result.meta.currency === 'GBp';

    // `yahoo-finance2` types `priceHint` as required, but its own source notes
    // that other "required" meta fields are absent for real instruments, and
    // `Decimal.toDecimalPlaces(undefined)` rounds to nothing at all — the
    // float32 artifact this whole function exists to strip would reach
    // `NUMERIC` silently. Refusing the response instead surfaces as `failed`
    // for this instrument in `refreshPrices`, which the UI shows as
    // unvaluable; a rounding default guessed here would be a made-up price.
    if (!Number.isInteger(priceHint) || priceHint < 0) {
      throw new Error(`Yahoo returned no usable priceHint for ${ref.symbol}`);
    }

    const bars: PriceBar[] = [];
    for (const quote of result.quotes) {
      // Not `close <= 0`: `undefined <= 0` is false, so an absent close would
      // pass that gate and throw inside `new Decimal(...)`, losing every other
      // bar in the batch with it. This is validating a JSON number before it
      // becomes a `Decimal`, not arithmetic on one.
      if (typeof quote.close !== 'number' || !Number.isFinite(quote.close) || quote.close <= 0) {
        continue;
      }

      // The session date in the exchange's own timezone, not UTC — a UTC
      // date would shift GPW and NYSE bars onto the wrong calendar day
      // relative to each other (section 08).
      const date = Temporal.Instant.fromEpochMilliseconds(quote.date.getTime())
        .toZonedDateTimeISO(zone)
        .toPlainDate();

      // Yahoo's raw close arrives as a float32 artifact
      // (`155.67999267578125`); `priceHint` is the instrument's own decimal
      // precision, so rounding to it here is what keeps that artifact out of
      // `NUMERIC` (rule 1, section 08).
      let close = new Decimal(quote.close).toDecimalPlaces(priceHint);
      if (isPence) close = close.dividedBy(100);

      bars.push({ instrumentId: ref.instrumentId, date, close: Money.of(close, ref.currency) });
    }

    // Yahoo's unofficial API occasionally, and without any error or short
    // status code, hands back a well-formed response that is simply
    // shorter than what was asked for — observed live (CU-869ej7zk8) as a
    // multi-year `from` coming back covering only the last few weeks, and
    // separately as a request that came back missing a year-wide slice out
    // of its *middle*. Neither reproduces against a direct call from
    // outside Vercel, so this is the network path, not `yahoo-finance2`
    // itself. `bars` alone can't tell a truncated response apart from an
    // instrument that genuinely has no earlier history; `meta.firstTradeDate`
    // — Yahoo's own claim about when the instrument started trading — can.
    // A gap this wide anywhere, leading edge included, means the response
    // is not trustworthy: throwing here (rather than returning a partial
    // `bars`) is what stops `markCovered` from ever recording it as covered
    // — see `makeBackfillPriceHistory`'s per-instrument catch.
    if (bars.length > 0) {
      const sorted = [...bars].sort((a, b) => Temporal.PlainDate.compare(a.date, b.date));
      const firstTradeDate =
        result.meta.firstTradeDate === null || result.meta.firstTradeDate === undefined
          ? null
          : Temporal.Instant.fromEpochMilliseconds(result.meta.firstTradeDate.getTime())
              .toZonedDateTimeISO(zone)
              .toPlainDate();
      const expectedStart =
        firstTradeDate !== null && Temporal.PlainDate.compare(firstTradeDate, from) > 0
          ? firstTradeDate
          : from;

      const leadGapDays = expectedStart.until(sorted[0]!.date).days;
      if (leadGapDays > MAX_TRADING_GAP_DAYS) {
        throw new Error(
          `Yahoo returned a truncated range for ${ref.symbol}: asked from ${expectedStart.toString()}, got data starting ${sorted[0]!.date.toString()}`,
        );
      }

      for (let i = 1; i < sorted.length; i++) {
        const gapDays = sorted[i - 1]!.date.until(sorted[i]!.date).days;
        if (gapDays > MAX_TRADING_GAP_DAYS) {
          throw new Error(
            `Yahoo returned a gapped range for ${ref.symbol}: ${sorted[i - 1]!.date.toString()} to ${sorted[i]!.date.toString()}`,
          );
        }
      }
    }

    return bars;
  },
};
