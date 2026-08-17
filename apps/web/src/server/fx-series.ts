import {
  chartSource,
  currency as toCurrency,
  defaultFxSourcePreference,
  makeRefreshFxSeries,
  pairSeries,
  summarizeFxSeries,
  Temporal,
  type CurrencyPair,
  type FxSeriesPoint,
  type FxSeriesSummary,
  type FxSourcePreference,
} from '@finansify/core';

import { fxRangeMonths, NBP_ARCHIVE_START, type FxPair, type FxRangeId } from '@/lib/fx-pairs';
import { clock, getFxProvider, getFxQuoteProvider, getFxRates } from '@/server/container';

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
 * Under the default preference the rows land in the same `fx_rates` table the
 * portfolio total reads, so the chart and the number above it cannot disagree —
 * they are the same rows (ADR 0017). A reader who picks the market feed is
 * choosing to look at a different series on purpose, which the card labels;
 * ADR 0018 has the argument for allowing that at all.
 */
export async function readFxPairSeries(
  pairId: FxPair,
  rangeId: FxRangeId,
  preference: FxSourcePreference = defaultFxSourcePreference,
): Promise<FxPairSeries> {
  const pair = pairOf(pairId);
  const today = clock.now().toZonedDateTimeISO(displayTimeZone).toPlainDate();
  const window = windowFor(rangeId, today);

  // Nothing in here may throw past this point. `makeRefreshFxSeries` already
  // reports a provider failure rather than raising it, but the repository reads
  // around it were left bare — and one failing `seriesFor` took down the whole
  // page, including the two macro cards that had nothing to do with it.
  // `data-sources.md` is explicit: serve what is known, labelled, or serve
  // nothing; never turn a data gap into an error boundary.
  const source = chartSource(preference);

  try {
    if (source === 'yahoo') return await marketSeries(pair, window);

    const fx = getFxRates();
    const refresh = makeRefreshFxSeries({ fx, provider: getFxProvider(), today: () => today });

    const report = await refresh(pair, window);

    const wanted = [pair.base, pair.quote].filter((code) => code !== toCurrency('PLN'));
    const stored = await fx.seriesFor(wanted, window.from, window.to, 'nbp');
    const history = pairSeries(pair, stored);

    return {
      summary: summarizeFxSeries(pair, history),
      history,
      error: report.error,
    };
  } catch (cause) {
    return {
      summary: null,
      history: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * The same pair from the market feed instead of NBP's archive.
 *
 * Nothing is stored. Yahoo answers a whole window in **one** request — no
 * chunking, unlike the 367-day NBP archive — so persisting it would buy a cache
 * hit at the cost of a second series in `fx_rates` that only this chart reads.
 * The valuation path is the one that stores quotes, and only when the reader
 * has scoped the choice that far (`server/fx-rates.ts`).
 *
 * The pair is fetched directly rather than crossed through PLN: Yahoo quotes
 * `EURUSD=X` as its own instrument, and dividing two of its PLN legs would
 * introduce a spread that the direct quote does not have.
 */
async function marketSeries(
  pair: CurrencyPair,
  window: { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate },
): Promise<FxPairSeries> {
  const quotes = await getFxQuoteProvider().fetchPairSeries(pair, window.from, window.to);

  const history: readonly FxSeriesPoint[] = quotes.map((quote) => ({
    // A quote belongs to a moment; the chart's grain is a day. Warsaw rather
    // than UTC so a late-evening tick lands on the day a Polish reader would
    // call it, consistent with every other date on the page.
    date: quote.at.toZonedDateTimeISO(displayTimeZone).toPlainDate(),
    rate: quote.rate,
  }));

  return { summary: summarizeFxSeries(pair, history), history, error: null };
}
