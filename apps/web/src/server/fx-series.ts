import {
  currency as toCurrency,
  makeRefreshFxSeries,
  pairSeries,
  summarizeFxSeries,
  Temporal,
  type CurrencyPair,
  type FxSeriesPoint,
  type FxSeriesSummary,
} from '@finansify/core';

import { fxRangeMonths, NBP_ARCHIVE_START, type FxPair, type FxRangeId } from '@/lib/fx-pairs';
import { clock, getFxProvider, getFxRates } from '@/server/container';

export interface FxPairSeries {
  readonly summary: FxSeriesSummary | null;
  /** Oldest first, for the chart. */
  readonly history: readonly FxSeriesPoint[];
  /** Set when a refresh was attempted and failed; whatever is stored is still shown. */
  readonly error: string | null;
}

const displayTimeZone = 'Europe/Warsaw';

export function pairOf(pair: FxPair): CurrencyPair {
  return { base: toCurrency(pair.base), quote: toCurrency(pair.quote) };
}

export function windowFor(
  rangeId: FxRangeId,
  today: Temporal.PlainDate,
): { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate } {
  const from =
    rangeId === 'MAX'
      ? Temporal.PlainDate.from(NBP_ARCHIVE_START)
      : today.subtract({ months: fxRangeMonths[rangeId] });

  return { from, to: today };
}

/**
 * One currency pair over one window, refreshed first if what is stored falls
 * short of it.
 *
 * **Deliberately not keyed by user, and it must stay that way** — an NBP mid
 * rate is a fact about the world, not about an account (ADR 0010, rule 5).
 * Same reasoning as `server/indicators.ts`, and the same absence of a `userId`
 * parameter so the mistake cannot be made quietly.
 *
 * The rows land in the same `fx_rates` table the portfolio total reads, so a
 * chart and the number above it can never disagree: they are the same rows.
 * That is the whole argument for NBP over a market feed here — see ADR 0017.
 */
export async function readFxPairSeries(pairId: FxPair, rangeId: FxRangeId): Promise<FxPairSeries> {
  const pair = pairOf(pairId);
  const today = clock.now().toZonedDateTimeISO(displayTimeZone).toPlainDate();
  const window = windowFor(rangeId, today);

  const fx = getFxRates();
  const refresh = makeRefreshFxSeries({ fx, provider: getFxProvider(), today: () => today });

  const report = await refresh(pair, window);

  const wanted = [pair.base, pair.quote].filter((code) => code !== toCurrency('PLN'));
  const stored = await fx.seriesFor(wanted, window.from, window.to);
  const history = pairSeries(pair, stored);

  return {
    summary: summarizeFxSeries(pair, history),
    history,
    error: report.error,
  };
}
