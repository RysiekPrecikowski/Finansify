'use client';

import { useEffect, useState } from 'react';

import { RangeTabs } from '@/components/dashboard/range-tabs';
import { ValueChart } from '@/components/dashboard/value-chart';
import { dashboardHref, dashboardUrl, type Range } from '@/lib/dashboard-params';
import { buildHeroSeries, formatChartValue, type ApiValueSeriesResponse } from '@/lib/hero-series';
import { useI18n } from '@/lib/i18n/client';
import { useDashboardParams } from '@/lib/use-dashboard-params';

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
  const { locale } = useI18n();
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
      ? buildHeroSeries(response.points, (value) =>
          formatChartValue(value, response.currency, locale),
        )
      : null;

  return (
    <div className="flex flex-col gap-2">
      {hero !== null && hero.points.length >= 2 ? (
        <ValueChart
          points={hero.points}
          partialBoundary={hero.partialBoundary}
          direction={hero.direction}
          highLabel={hero.highLabel}
          lowLabel={hero.lowLabel}
          label={ariaLabel}
          seriesKey={params.range}
        />
      ) : (
        // Same footprint as the chart, so the range tabs below don't jump
        // once a series lands — `aria-hidden`, there is nothing to read yet.
        <div className="h-40 w-full sm:h-56" aria-hidden="true" />
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
    </div>
  );
}
