import { Temporal, type SeriesGrain } from '@finansify/core';

import { ranges, type Range } from '@/lib/dashboard-params';

/**
 * How far back a range reaches, clamped to the portfolio's own start: asking
 * for history before the first transaction would only ever return zeros, and
 * it is one fewer thing `portfolioValueSeries` has to walk through.
 * `firstTransactionOn === null` (no transactions at all) leaves `from`
 * unclamped — the caller has nothing to clamp against, and the series comes
 * back empty either way.
 */
export function windowFor(
  range: Range,
  today: Temporal.PlainDate,
  firstTransactionOn: Temporal.PlainDate | null,
): { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate } {
  const uncapped = ((): Temporal.PlainDate => {
    switch (range) {
      case '1D':
        return today.subtract({ days: 1 });
      case '1W':
        return today.subtract({ days: 7 });
      case '1M':
        return today.subtract({ months: 1 });
      case 'YTD':
        return Temporal.PlainDate.from({ year: today.year, month: 1, day: 1 });
      case '1Y':
        return today.subtract({ years: 1 });
      case 'MAX':
        return firstTransactionOn ?? today;
    }
  })();

  const from =
    firstTransactionOn !== null && Temporal.PlainDate.compare(firstTransactionOn, uncapped) > 0
      ? firstTransactionOn
      : uncapped;

  return { from, to: today };
}

/**
 * The grain a range defaults to when the request doesn't override it — the
 * "configurable accuracy" half of CU-869ej7zk8: a caller may always pass
 * `?grain=` explicitly, but this is what keeps an unadorned `MAX` request in
 * the hundreds of points rather than the thousands. Boundaries are in
 * calendar days, not tied to a specific `Range` id, so a `MAX` window that
 * happens to be short (a portfolio a month old) still gets `day` precision.
 */
const DAY_GRAIN_MAX_DAYS = 366;
const WEEK_GRAIN_MAX_DAYS = 366 * 5;

export function defaultGrainFor(window: {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
}): SeriesGrain {
  const days = window.from.until(window.to).days;
  if (days <= DAY_GRAIN_MAX_DAYS) return 'day';
  if (days <= WEEK_GRAIN_MAX_DAYS) return 'week';
  return 'month';
}

export interface SeriesParams {
  readonly range: Range;
  readonly grain: SeriesGrain | null;
  readonly refresh: boolean;
}

const grains: readonly SeriesGrain[] = ['day', 'week', 'month'];

function isSeriesGrain(value: unknown): value is SeriesGrain {
  return typeof value === 'string' && (grains as readonly string[]).includes(value);
}

function isRange(value: unknown): value is Range {
  return typeof value === 'string' && (ranges as readonly string[]).includes(value);
}

/**
 * Unrecognised or absent values fall back rather than throwing — these come
 * straight off a `URLSearchParams`. `grain: null` means "let the caller pick
 * the default for the resolved window", not "day" — a literal default here
 * would silently override a range-appropriate choice for every request that
 * doesn't pass one.
 */
export function parseSeriesParams(searchParams: URLSearchParams): SeriesParams {
  const range = searchParams.get('range');
  const grain = searchParams.get('grain');

  return {
    range: isRange(range) ? range : '1M',
    grain: isSeriesGrain(grain) ? grain : null,
    refresh: searchParams.get('refresh') === '1',
  };
}
