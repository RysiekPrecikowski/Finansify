'use client';

import { RangeTabs } from '@/components/dashboard/range-tabs';
import { ValueChart } from '@/components/dashboard/value-chart';
import { type ChartSeries } from '@/lib/chart-series';
import { dashboardHref, dashboardUrl } from '@/lib/dashboard-params';
import { useDashboardParams } from '@/lib/use-dashboard-params';
import { type Range } from '@/lib/fixtures/portfolio';

/**
 * The chart range switches without a round trip. Every range is already on the
 * client — six series of 64 points — so asking the server to redraw a line the
 * browser is holding would buy nothing but the latency that makes the switch
 * feel slow.
 *
 * **The URL stays the single source of truth**, on the client as much as on the
 * server: the range is read from it, and a switch writes it straight back with
 * `replaceState`. Holding it in `useState` instead would fork the truth in two,
 * and the copies drift the moment anything else navigates — a chip, a sort, or
 * the back button.
 *
 * Range is safe to switch this way because nothing on the server reads it:
 * `class` and `sort` still drive the chips and the holdings list from there.
 */
export interface ChartCardProps {
  readonly series: Readonly<Record<Range, ChartSeries>>;
  readonly rangeLabels: Readonly<Record<Range, string>>;
  readonly navLabel: string;
}

export function ChartCard({ series, rangeLabels, navLabel }: ChartCardProps) {
  const params = useDashboardParams();

  function select(next: Range): void {
    // `replaceState`, not `pushState`: a range is a way of looking at the page,
    // not a place you arrived at, and flicking through six of them should not
    // leave six entries to back out through.
    window.history.replaceState(null, '', dashboardUrl(dashboardHref(params, { range: next })));
  }

  return (
    <div className="flex flex-col gap-2">
      <ValueChart {...series[params.range]} seriesKey={params.range} />
      <RangeTabs
        labels={rangeLabels}
        navLabel={navLabel}
        selected={params.range}
        onSelect={select}
      />
    </div>
  );
}
