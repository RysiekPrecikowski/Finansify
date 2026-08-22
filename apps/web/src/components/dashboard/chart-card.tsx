'use client';

import { useEffect, useState } from 'react';

import { BenchmarkSelect } from '@/components/dashboard/benchmark-select';
import { RangeTabs } from '@/components/dashboard/range-tabs';
import { ValueChart } from '@/components/dashboard/value-chart';
import {
  buildBenchmarkSeries,
  benchmarkReturn,
  returnDifference,
  seriesReturn,
  type Benchmark,
} from '@/lib/dashboard/benchmarks';
import { dashboardHref, dashboardUrl, type Range } from '@/lib/dashboard-params';
import { directionSurface, formatRatioAsPercent, type Direction } from '@/lib/format';
import {
  buildHeroSeries,
  formatChartDate,
  formatChartValue,
  type ApiValueSeriesResponse,
} from '@/lib/hero-series';
import { useI18n } from '@/lib/i18n/client';
import { useDashboardParams } from '@/lib/use-dashboard-params';
import { cn } from '@/lib/utils';

/**
 * Caps how many `refresh=1` rounds one mounted chart will chase for a single
 * range. `makeBackfillPriceHistory` already bounds a round to `BACKFILL_BATCH`
 * instruments, so a portfolio with more than `6 * BACKFILL_BATCH` quoted
 * instruments stays `pending` after this — correct, not a bug: the next visit
 * (or the next range switch back) picks up where this one left off, since
 * coverage already written by earlier rounds is never re-fetched.
 */
const MAX_REFRESH_ROUNDS = 6;

async function fetchSeries(range: Range, refresh: boolean): Promise<ApiValueSeriesResponse> {
  const query = new URLSearchParams({ range });
  if (refresh) query.set('refresh', '1');

  const response = await fetch(`/api/portfolio/value-series?${query.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`value-series request failed with status ${response.status}`);
  return (await response.json()) as ApiValueSeriesResponse;
}

/**
 * The chart range switches without a round trip **when the range is already
 * on the client** — the URL stays the single source of truth (as it did for
 * the old fixture data), a switch writes it back with `replaceState`, and a
 * range whose series is already cached just re-renders from state.
 *
 * A range that isn't cached yet (the common case: only the server-rendered
 * default range arrives with the first paint) fetches once, storage-only,
 * then — if `pending` — polls `?refresh=1` up to `MAX_REFRESH_ROUNDS` times,
 * each round backfilling a little more and shrinking the chart's dashed
 * "still loading" prefix (`ValueChart`'s `partialBoundary`). This is the
 * "show data as fast as possible, mark what's still loading" requirement
 * CU-869ej7zk8 was scoped around.
 */
export interface ChartCardProps {
  readonly initialRange: Range;
  readonly initialResponse: ApiValueSeriesResponse;
  readonly rangeLabels: Readonly<Record<Range, string>>;
  readonly navLabel: string;
  readonly ariaLabel: string;
  readonly loadingLabel: string;
  readonly unsupportedRangeLabel: string;
}

/**
 * One of the three figures under the range tabs. `null` renders a dash rather
 * than a zero — a window with no return to compute (a portfolio that opened at
 * zero) has no figure, and zero would read as "flat", which is a claim.
 */
function MetricTile({
  label,
  ratio,
  locale,
  title,
}: Readonly<{
  label: string;
  ratio: string | null;
  locale: ReturnType<typeof useI18n>['locale'];
  title?: string;
}>) {
  const direction: Direction =
    ratio === null || Number(ratio) === 0 ? 'flat' : Number(ratio) > 0 ? 'up' : 'down';

  return (
    <div className="bg-card flex flex-col gap-1 rounded-xl px-2.5 py-3 sm:px-3.5" title={title}>
      {/* No `tracking-wide` and tighter padding under `sm`: at 390 px each of
          the three tiles gets ~90 px of content box, and the longest label
          ("PORTFEL (TWR)") ellipsised to "PORTFEL (T…" — a truncated label on
          the one tile whose meaning depends on the parenthetical. */}
      <span className="text-muted-foreground truncate text-[0.6875rem] font-medium uppercase sm:tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          'w-fit rounded-md px-1.5 py-0.5 text-sm font-semibold tabular-nums',
          directionSurface[direction],
        )}
      >
        {ratio === null ? '—' : formatRatioAsPercent(ratio, locale, { signed: true })}
      </span>
    </div>
  );
}

export function ChartCard({
  initialRange,
  initialResponse,
  rangeLabels,
  navLabel,
  ariaLabel,
  loadingLabel,
  unsupportedRangeLabel,
}: ChartCardProps) {
  const params = useDashboardParams();
  const { locale, dictionary } = useI18n();
  const [cache, setCache] = useState<Partial<Record<Range, ApiValueSeriesResponse>>>({
    [initialRange]: initialResponse,
  });
  const [loadingRange, setLoadingRange] = useState<Range | null>(null);

  function select(next: Range): void {
    // `replaceState`, not `pushState`: a range is a way of looking at the page,
    // not a place you arrived at, and flicking through several of them should
    // not leave that many entries to back out through.
    window.history.replaceState(null, '', dashboardUrl(dashboardHref(params, { range: next })));
  }

  /** Same reasoning as `select`, for the same reason: a comparison you are trying on, not a page you navigated to. */
  function selectBenchmark(next: Benchmark): void {
    window.history.replaceState(null, '', dashboardUrl(dashboardHref(params, { benchmark: next })));
  }

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      // Read from `cache` once, here, rather than depending on it: this effect
      // only re-runs when `params.range` changes, and every update within one
      // run is tracked in the local `current` variable, not by re-reading
      // state — a `setCache` call inside this effect must never retrigger it.
      let current = cache[params.range];

      if (current === undefined) {
        setLoadingRange(params.range);
        try {
          current = await fetchSeries(params.range, false);
        } catch {
          if (!cancelled) setLoadingRange(null);
          return;
        }
        if (cancelled) return;
        setCache((previous) => ({ ...previous, [params.range]: current }));
      }

      let round = 0;
      while (current.pending && current.error === null && round < MAX_REFRESH_ROUNDS) {
        if (cancelled) return;
        setLoadingRange(params.range);
        try {
          current = await fetchSeries(params.range, true);
        } catch {
          break;
        }
        if (cancelled) return;
        setCache((previous) => ({ ...previous, [params.range]: current }));
        round += 1;
      }

      if (!cancelled) setLoadingRange(null);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [params.range]);

  const response = cache[params.range];
  const isLoading = loadingRange === params.range;
  const hero =
    response !== undefined
      ? buildHeroSeries(
          response.points,
          (value) => formatChartValue(value, response.currency, locale),
          (date) => formatChartDate(date, locale),
        )
      : null;

  const strings = dictionary.dashboard;
  // Keyed on range *and* benchmark, so switching the index re-seeds the path
  // and the tween treats it as a new series rather than as a re-render.
  const seriesKey = `${params.range}:${params.benchmark}`;
  const benchmarkSeries =
    hero === null ? [] : buildBenchmarkSeries(hero.points, params.benchmark, params.range);

  // Read off the *source* points, not the resampled ones: LTTB can drop the
  // literal last observation from a downsampled window, and the figure a
  // reader compares against their broker has to be the real endpoint.
  const portfolioRatio =
    response === undefined
      ? null
      : seriesReturn(response.points.map((point) => Number(point.value)));
  const benchmarkRatio = benchmarkReturn(params.benchmark, params.range, hero?.points.length ?? 0);
  const differenceRatio = returnDifference(portfolioRatio, benchmarkRatio);

  return (
    <div className="flex flex-col gap-2">
      {/* The card's own header row: what the chart is, and what it is being
          compared against. */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-[0.6875rem] font-medium tracking-wide uppercase">
          {strings.chart.title}
        </h2>
        <BenchmarkSelect
          selected={params.benchmark}
          names={strings.benchmark.names}
          label={strings.benchmark.label}
          ariaLabel={strings.benchmark.select}
          note={strings.benchmark.demo}
          onSelect={selectBenchmark}
        />
      </div>

      {hero !== null && hero.points.length >= 2 ? (
        <ValueChart
          points={hero.points}
          partialBoundary={hero.partialBoundary}
          direction={hero.direction}
          highLabel={hero.highLabel}
          lowLabel={hero.lowLabel}
          midLabel={hero.midLabel}
          dateLabels={hero.dateLabels}
          valueLabels={hero.valueLabels}
          label={ariaLabel}
          seriesKey={seriesKey}
          benchmarkPoints={benchmarkSeries}
          portfolioLabel={strings.chart.legendPortfolio}
          benchmarkLabel={strings.benchmark.names[params.benchmark]}
        />
      ) : (
        // Same footprint as the chart — svg plus its x-axis row — so the range
        // tabs below don't jump once a series lands. `aria-hidden`, there is
        // nothing to read yet.
        <div className="flex flex-col gap-1" aria-hidden="true">
          <div className="h-40 w-full sm:h-56" />
          <div className="h-[14px] w-full" />
        </div>
      )}

      {isLoading && (
        <p className="text-muted-foreground text-xs" role="status">
          {loadingLabel}
        </p>
      )}

      <RangeTabs
        labels={rangeLabels}
        navLabel={navLabel}
        selected={params.range}
        onSelect={select}
        unsupportedLabel={unsupportedRangeLabel}
      />

      {/* Portfolio, index, and the gap between them — all three for whichever
          range is selected, so the tiles change with the tabs directly above
          them. */}
      <div className="mt-1 grid grid-cols-3 gap-3">
        <MetricTile
          label={strings.performance.portfolio}
          ratio={portfolioRatio}
          locale={locale}
          title={strings.performance.note}
        />
        <MetricTile
          label={strings.benchmark.names[params.benchmark]}
          ratio={benchmarkRatio}
          locale={locale}
          title={strings.benchmark.demo}
        />
        <MetricTile
          label={strings.performance.difference}
          ratio={differenceRatio}
          locale={locale}
          title={strings.benchmark.demo}
        />
      </div>
    </div>
  );
}
