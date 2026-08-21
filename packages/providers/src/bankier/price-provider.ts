import {
  Money,
  Temporal,
  type PriceBar,
  type PriceProvider,
  type ResolvedSymbol,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { z } from 'zod';

import { fetchBankierFundChart } from './client';

const WARSAW = 'Europe/Warsaw';

/**
 * Fixed ranges, widest last — mirrors `gpw/price-provider.ts`'s `WINDOWS`,
 * except every range here (including `max`) is a real query parameter rather
 * than one fixed set plus a separate unbounded mode. A routine 15-minute
 * refresh asks for the smallest range that covers `from`; only an actual
 * backfill pays `max`'s full-history payload (confirmed live: a fund tracked
 * since 2011 returns its whole history, ~3,900 points, in one response).
 */
const RANGES = [
  { range: '1m', days: 31 },
  { range: '3m', days: 92 },
  { range: '6m', days: 183 },
  { range: '1y', days: 366 },
  { range: '3y', days: 1096 },
  { range: '5y', days: 1827 },
] as const;

function rangeCovering(from: Temporal.PlainDate, today: Temporal.PlainDate): string {
  const daysNeeded = from.until(today).days;
  return (RANGES.find((r) => daysNeeded <= r.days) ?? { range: 'max' }).range;
}

const seriesSchema = z.tuple([z.number(), z.number()]);

const chartSchema = z.object({
  data: z.array(
    z.object({
      data: z.array(seriesSchema),
      // Absent (`{}`) for a symbol the endpoint does not recognise — not
      // missing entirely — so `currency` stays optional rather than defaulted.
      profile_data: z.object({ currency: z.string().optional() }).optional(),
    }),
  ),
});

export const bankierPriceProvider: PriceProvider = {
  name: 'bankier',

  /**
   * `fund` (TFI units, PPK's holdings among them — PPK is a tax wrapper, not
   * an `InstrumentKind`) is the only kind bankier serves here. It also
   * answers for equities and other GPW-listed kinds (ADR 0022's context), but
   * nothing in this change routes to it for those — `gpw` already covers
   * them with full history, and bankier's own equity coverage is spot-only.
   */
  capabilitiesFor(kind) {
    return kind === 'fund' ? { history: true, spot: false } : { history: false, spot: false };
  },

  /**
   * `ref.symbol` is bankier's own fund symbol (e.g. `AGF04`) — its own
   * identifier, unrelated to the fund's ISIN, same dual-identifier situation
   * as GPW's ISIN vs. Catalyst ticker (ADR 0023).
   */
  async fetchDailyBars(
    ref: ResolvedSymbol,
    from: Temporal.PlainDate,
  ): Promise<readonly PriceBar[]> {
    const today = Temporal.Now.plainDateISO(WARSAW);
    const range = rangeCovering(from, today);

    const raw = await fetchBankierFundChart(ref.symbol, range);
    const [entry] = chartSchema.parse(raw).data;
    if (entry === undefined || entry.data.length === 0) return [];

    const responseCurrency = entry.profile_data?.currency;
    if (responseCurrency !== undefined && responseCurrency !== ref.currency) {
      throw new Error(
        `bankier reports ${ref.symbol} in ${responseCurrency}, expected ${ref.currency}`,
      );
    }

    const bars: PriceBar[] = [];
    for (const [t, value] of entry.data) {
      if (!Number.isFinite(value) || value <= 0) continue;

      const date = Temporal.Instant.fromEpochMilliseconds(t)
        .toZonedDateTimeISO(WARSAW)
        .toPlainDate();

      bars.push({
        instrumentId: ref.instrumentId,
        date,
        close: Money.of(new Decimal(value), ref.currency),
      });
    }

    return bars;
  },
};
