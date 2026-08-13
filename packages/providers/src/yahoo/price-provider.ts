import {
  Money,
  Temporal,
  type PriceBar,
  type PriceProvider,
  type ResolvedSymbol,
} from '@finansify/core';
import Decimal from 'decimal.js';

import { callYahoo, yahooFinance } from './client';

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

    const bars: PriceBar[] = [];
    for (const quote of result.quotes) {
      if (quote.close === null || quote.close <= 0) continue;

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
      const close = new Decimal(quote.close).toDecimalPlaces(priceHint);

      bars.push({ instrumentId: ref.instrumentId, date, close: Money.of(close, ref.currency) });
    }

    return bars;
  },
};
