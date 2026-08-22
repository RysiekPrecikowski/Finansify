import { benchmarks, defaultBenchmark, type Benchmark } from '@/lib/dashboard/benchmarks';
import {
  assetClasses,
  sortOrders,
  type AssetClass,
  type SortOrder,
} from '@/lib/dashboard/snapshot';

/** The hero chart's range control. */
export const ranges = ['1D', '1W', '1M', 'YTD', '1Y', 'MAX'] as const;
export type Range = (typeof ranges)[number];

/**
 * `1D`/`1W` stay in the tab strip but are not selectable yet: the price cache
 * only ever holds `d1` bars (`docs/architecture.md`), so there is no data
 * finer than a day to draw either of them from. CU-869em7hdp tracks the
 * intraday ingestion that would unlock them; this list is what both the route
 * handler and the tab strip check against, so unlocking a range later is a
 * one-line change here rather than a change in two places that could drift.
 */
export const unsupportedRanges: readonly Range[] = ['1D', '1W'];

export function isSupportedRange(range: Range): boolean {
  return !unsupportedRanges.includes(range);
}

/**
 * Range, filter and sort live in the URL. The dashboard renders on the server,
 * every control is a real link, and the view survives a reload and a share —
 * which client-side tab state does not.
 *
 * The chart range is the one control that also switches without a navigation:
 * all six series are already on the client, so re-fetching the page to redraw
 * a line the browser is holding would only add latency. It writes the same URL
 * back with `history.replaceState`, so reload and share behave identically —
 * see `components/dashboard/chart-card.tsx`.
 *
 * That only holds because **every control builds its href from the live params**
 * (`lib/use-dashboard-params.ts`) rather than from a server-rendered snapshot.
 * A href baked at render time carries the range as it was *then*, so clicking a
 * chip after a client-side switch would drop the range the user picked and the
 * next reload would show something else.
 */
export interface DashboardParams {
  readonly range: Range;
  readonly assetClass: AssetClass | null;
  readonly sort: SortOrder;
  /**
   * Which index the hero chart overlays. Switches client-side exactly the way
   * `range` does — the series is derived on the client
   * (`lib/dashboard/benchmarks.ts`), so there is nothing for a server round
   * trip to fetch — but still lives in the URL, so a shared link shows the same
   * comparison the sender was looking at.
   */
  readonly benchmark: Benchmark;
}

export const defaultDashboardParams: DashboardParams = {
  range: '1M',
  assetClass: null,
  sort: 'valueDesc',
  benchmark: defaultBenchmark,
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(candidates: readonly T[], value: string | undefined): T | null {
  return candidates.find((candidate) => candidate === value) ?? null;
}

/**
 * Unknown or malformed values fall back to the default rather than erroring.
 * A `1D`/`1W` in the URL falls back the same way — a hand-edited link to an
 * unsupported range must not reach a `ChartCard` that has nothing to show for
 * it (`unsupportedRanges`, above).
 */
export function parseDashboardParams(raw: RawSearchParams): DashboardParams {
  const range = oneOf(ranges, first(raw.range)) ?? defaultDashboardParams.range;

  return {
    range: isSupportedRange(range) ? range : defaultDashboardParams.range,
    assetClass: oneOf(assetClasses, first(raw.class)),
    sort: oneOf(sortOrders, first(raw.sort)) ?? defaultDashboardParams.sort,
    benchmark: oneOf(benchmarks, first(raw.bench)) ?? defaultDashboardParams.benchmark,
  };
}

export interface DashboardHref {
  readonly pathname: '/dashboard';
  readonly query: Record<string, string>;
}

/** Keeps the parameters you are not changing, so controls compose. */
export function dashboardHref(
  current: DashboardParams,
  changes: Partial<DashboardParams>,
): DashboardHref {
  const next = { ...current, ...changes };
  const query: Record<string, string> = {};

  if (next.range !== defaultDashboardParams.range) query.range = next.range;
  if (next.assetClass !== null) query.class = next.assetClass;
  if (next.sort !== defaultDashboardParams.sort) query.sort = next.sort;
  if (next.benchmark !== defaultDashboardParams.benchmark) query.bench = next.benchmark;

  return { pathname: '/dashboard', query };
}

/**
 * The same href as a string, for `history.replaceState`. Kept here so the query
 * shape stays known to this module alone — a caller assembling `?range=` by
 * hand is how the URL and the links drift apart.
 */
export function dashboardUrl(href: DashboardHref): string {
  const query = new URLSearchParams(href.query).toString();
  return query === '' ? href.pathname : `${href.pathname}?${query}`;
}
