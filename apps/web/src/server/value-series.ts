import {
  currency as toCurrency,
  makeBackfillFxHistory,
  makeBackfillPriceHistory,
  makeListPositions,
  portfolioValueSeries,
  sampleDates,
  Temporal,
  type Currency,
  type InstrumentPosition,
  type SeriesGrain,
  type Transaction,
  type UserId,
  type ValuePoint,
} from '@finansify/core';

import { type Range } from '@/lib/dashboard-params';
import { type ApiValuePoint, type ApiValueSeriesResponse } from '@/lib/hero-series';
import { defaultGrainFor, windowFor } from '@/lib/value-series-params';
import { bondUnitValuesFor } from '@/server/bond-valuation';
import {
  clock,
  getFxProvider,
  getFxRates,
  getInstruments,
  getMarketPrices,
  getPriceProvider,
  getSymbols,
  scopedLedgerFor,
} from '@/server/container';

const displayTimeZone = 'Europe/Warsaw';
const PLN = toCurrency('PLN');

export interface ValueSeriesParams {
  readonly range: Range;
  readonly grain: SeriesGrain | null;
  readonly presentIn: Currency;
}

export interface ValueSeriesResult {
  readonly points: readonly ValuePoint[];
  readonly grain: SeriesGrain;
  readonly currency: Currency;
  /** A backfill round would add data the reader hasn't seen yet — the client keeps asking while this is true. */
  readonly pending: boolean;
  /** Set when a refresh was attempted and failed; whatever is stored is still returned. */
  readonly error: string | null;
}

function earliestTradeDate(transactions: readonly Transaction[]): Temporal.PlainDate | null {
  return transactions.reduce<Temporal.PlainDate | null>((earliest, transaction) => {
    if (earliest === null || Temporal.PlainDate.compare(transaction.tradeDate, earliest) < 0) {
      return transaction.tradeDate;
    }
    return earliest;
  }, null);
}

/**
 * Everything both `readValueSeries` and `refreshValueSeries` need to agree
 * on: the window, the grain, the sample dates, and which instruments and
 * currencies the series actually touches. Computed once so a backfill round
 * and the read that follows it can never disagree about what "this window"
 * means.
 */
async function resolveContext(userId: UserId, params: { range: Range; grain: SeriesGrain | null }) {
  const ledger = scopedLedgerFor(userId);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });
  const [view, transactions] = await Promise.all([listPositions(), ledger.listTransactions()]);

  const today = clock.now().toZonedDateTimeISO(displayTimeZone).toPlainDate();
  const window = windowFor(params.range, today, earliestTradeDate(transactions));
  const grain = params.grain ?? defaultGrainFor(window);
  const dates = sampleDates(window.from, window.to, grain);

  // Every instrument ever traded, not just what is open today — a position
  // that has since closed still needs a price for the part of the window it
  // was held in. `listPositions` already derives both lists from the whole
  // ledger, so this is the union rather than a second query.
  const allPositions: readonly InstrumentPosition[] = [...view.open, ...view.closed];
  const quotedPositions = allPositions.filter((position) => position.instrument.kind !== 'bond');
  const bondPositions = allPositions.filter((position) => position.instrument.kind === 'bond');
  const quotedIds = quotedPositions.map((position) => position.instrument.id);
  const instrumentCurrency = new Map(
    allPositions.map((position) => [position.instrument.id, position.instrument.currency]),
  );

  return { transactions, window, grain, dates, quotedIds, bondPositions, instrumentCurrency };
}

/**
 * Storage only — no network, safe on the render path. Reads whatever
 * `instrument_prices`/`fx_rates` already hold and reconstructs the series
 * from it; `pending` tells the caller whether a `refreshValueSeries` round
 * would still add anything.
 *
 * The historical FX leg is always NBP, regardless of the reader's valuation
 * preference (ADR 0018 lets a reader opt Yahoo into today's rate; this chart
 * does not follow that choice) — a second historical FX path is not worth
 * building for a chart that already labels its source the way the FX pair
 * card does.
 */
export async function readValueSeries(
  userId: UserId,
  params: ValueSeriesParams,
): Promise<ValueSeriesResult> {
  const { transactions, window, grain, dates, quotedIds, bondPositions, instrumentCurrency } =
    await resolveContext(userId, params);

  const currencies = [...new Set([...instrumentCurrency.values(), params.presentIn])].filter(
    (code) => code !== PLN,
  );

  const prices = getMarketPrices();
  const fx = getFxRates();
  const priceProvider = getPriceProvider();
  const fxProvider = getFxProvider();

  const [priceHistory, fxHistory, bondUnitValues, priceCoverage, fxCoverage] = await Promise.all([
    quotedIds.length > 0
      ? prices.historyFor(quotedIds, window.from, window.to, grain)
      : Promise.resolve(new Map()),
    currencies.length > 0
      ? fx.historyFor(currencies, window.from, window.to, grain, fxProvider.name)
      : Promise.resolve(new Map()),
    bondUnitValuesFor(bondPositions, dates, { refresh: false }),
    quotedIds.length > 0
      ? prices.coverageFor(quotedIds, priceProvider.name)
      : Promise.resolve(new Map()),
    currencies.length > 0
      ? fx.coverageFor(currencies, fxProvider.name)
      : Promise.resolve(new Map()),
  ]);

  const notYetCovered = (coveredFrom: Temporal.PlainDate | undefined): boolean =>
    coveredFrom === undefined || Temporal.PlainDate.compare(coveredFrom, window.from) > 0;

  const pending =
    quotedIds.some((id) => notYetCovered(priceCoverage.get(id))) ||
    currencies.some((code) => notYetCovered(fxCoverage.get(code)));

  const points = portfolioValueSeries({
    dates,
    transactions,
    priceHistory,
    fxHistory,
    bondUnitValues,
    instrumentCurrency,
    presentIn: params.presentIn,
  });

  return { points, grain, currency: params.presentIn, pending, error: null };
}

/**
 * One bounded backfill round — at most `BACKFILL_BATCH` instruments' worth of
 * price history, plus every currency the window needs — followed by the same
 * storage-only read `readValueSeries` does. Never called from the render
 * path; the route handler is the only caller.
 *
 * A provider failure is reported, never thrown (`docs/data-sources.md`):
 * whatever is already stored is still a valid, if `pending`, series.
 */
export async function refreshValueSeries(
  userId: UserId,
  params: ValueSeriesParams,
): Promise<ValueSeriesResult> {
  const { window, quotedIds, instrumentCurrency } = await resolveContext(userId, params);
  const currencies = [...new Set([...instrumentCurrency.values(), params.presentIn])].filter(
    (code) => code !== PLN,
  );

  let error: string | null = null;

  try {
    const backfillPrices = makeBackfillPriceHistory({
      prices: getMarketPrices(),
      symbols: getSymbols(),
      provider: getPriceProvider(),
      clock,
    });
    await backfillPrices(quotedIds, window.from);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  try {
    const backfillFx = makeBackfillFxHistory({ fx: getFxRates(), provider: getFxProvider() });
    const report = await backfillFx(currencies, window.from, window.to);
    error ??= report.error;
  } catch (cause) {
    error ??= cause instanceof Error ? cause.message : String(cause);
  }

  const read = await readValueSeries(userId, params);
  return error === null ? read : { ...read, error };
}

/**
 * Money crosses to the client as a decimal string here, and only here — the
 * one place `ValueSeriesResult`'s `Money`/`Temporal` values turn into the
 * plain JSON shape both the route handler and the chart's server-rendered
 * first paint send onward. `apps/web/AGENTS.md`: formatting (and the numeric
 * cast that precedes it) happens at the edge, never inside `core` or in
 * anything a client component imports.
 */
export function toApiValuePoints(points: readonly ValuePoint[]): readonly ApiValuePoint[] {
  return points.map((point) => ({
    date: point.date.toString(),
    value: point.value.amount.toFixed(2),
    status: point.status,
    unpriced: point.unpriced,
  }));
}

export function toApiValueSeriesResponse(result: ValueSeriesResult): ApiValueSeriesResponse {
  return {
    currency: result.currency,
    grain: result.grain,
    pending: result.pending,
    error: result.error,
    points: toApiValuePoints(result.points),
  };
}
