import { chartPointCount, resample } from './chart-series';
import { type Direction } from './format';
import { intlLocale, type Locale } from './i18n/locales';

/**
 * The hero chart's data shape, over the wire and in the client cache — plain
 * JSON, never a `Money`/`Decimal`/`Temporal` value. `@finansify/core` stays out
 * of the client bundle (`apps/web/AGENTS.md`), so this module and everything
 * that imports it must never import a runtime value from `core`, only the
 * server side (`apps/web/src/server/value-series.ts`) does that conversion.
 */
export interface ApiValuePoint {
  readonly date: string;
  /** A decimal string — parsed to a plain `number` below for pixel geometry only, never for arithmetic that could round money. */
  readonly value: string;
  readonly status: 'complete' | 'partial';
  readonly unpriced: readonly string[];
}

export type ApiSeriesGrain = 'day' | 'week' | 'month';

export interface ApiValueSeriesResponse {
  readonly currency: string;
  readonly grain: ApiSeriesGrain;
  readonly pending: boolean;
  readonly error: string | null;
  readonly points: readonly ApiValuePoint[];
}

/** What `ValueChart` actually renders — resampled to `chartPointCount`, geometry and labels only. */
export interface HeroChartSeries {
  readonly points: readonly number[];
  /**
   * How many of the leading (resampled) points are still `partial` — the
   * chart draws these dashed, at reduced opacity. Proportional to the source
   * series' own leading partial run, not an exact index: resampling (LTTB or
   * linear) does not preserve a 1:1 mapping to source indices, and this is
   * display geometry, not a figure anyone reads (same stance `chart-series.ts`
   * already takes for every other number in this type).
   */
  readonly partialBoundary: number;
  readonly direction: Direction;
  readonly highLabel: string;
  readonly lowLabel: string;
}

/** How many leading points are `partial`, stopping at the first `complete` one — a missing price is never in the middle of an otherwise-covered run in practice, but this only ever claims what it can see. */
export function partialPrefixLength(points: readonly Pick<ApiValuePoint, 'status'>[]): number {
  let count = 0;
  for (const point of points) {
    if (point.status !== 'partial') break;
    count += 1;
  }
  return count;
}

/** `'up'` when the window ends above where it started, mirroring `directionOf(Money)` without ever touching a `Money` (client-safe). */
export function directionFromSeries(values: readonly number[]): Direction {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || last === first) return 'flat';
  return last > first ? 'up' : 'down';
}

export function buildHeroSeries(
  points: readonly ApiValuePoint[],
  formatValue: (value: number) => string,
): HeroChartSeries {
  if (points.length === 0) {
    return {
      points: [],
      partialBoundary: 0,
      direction: 'flat',
      highLabel: formatValue(0),
      lowLabel: formatValue(0),
    };
  }

  const values = points.map((point) => Number(point.value));
  const resampled = resample(values, chartPointCount);
  const prefixRatio = partialPrefixLength(points) / points.length;
  const partialBoundary = Math.round(prefixRatio * resampled.length);

  return {
    points: resampled,
    partialBoundary,
    direction: directionFromSeries(resampled),
    highLabel: formatValue(Math.max(...resampled)),
    lowLabel: formatValue(Math.min(...resampled)),
  };
}

/**
 * A chart value formatted compactly, from a plain number and an ISO currency
 * code — never a `Money`. Used both for the server's initial render and for
 * the client after a `refresh=1` poll lands new points, so the two never drift
 * apart in how they format the same figure.
 */
export function formatChartValue(value: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
