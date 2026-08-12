'use client';

import { useState } from 'react';

import { RangeTabs } from '@/components/dashboard/range-tabs';
import { ValueChart } from '@/components/dashboard/value-chart';
import { type ChartSeries } from '@/lib/chart-series';
import { dashboardUrl, type DashboardHref } from '@/lib/dashboard-params';
import { type Range } from '@/lib/fixtures/portfolio';

/**
 * The one piece of dashboard view state the client owns. Every range is already
 * on the client — six series of 64 points — so asking the server to redraw a
 * line the browser is holding would buy nothing but the round trip that makes
 * the switch feel slow.
 *
 * The URL still decides what renders on load, and every switch writes it back
 * with `replaceState`, so reload and share behave exactly as they did when this
 * was a plain navigation. Range is safe to lift out this way because nothing
 * else reads it: `class` and `sort` still drive the chips and the holdings list
 * from the server.
 */
export interface ChartCardProps {
  readonly series: Readonly<Record<Range, ChartSeries>>;
  readonly hrefs: Readonly<Record<Range, DashboardHref>>;
  readonly rangeLabels: Readonly<Record<Range, string>>;
  readonly navLabel: string;
  readonly initialRange: Range;
}

export function ChartCard({ series, hrefs, rangeLabels, navLabel, initialRange }: ChartCardProps) {
  const [range, setRange] = useState(initialRange);

  function select(next: Range): void {
    setRange(next);
    // `replaceState`, not `pushState`: a range is a way of looking at the page,
    // not a place you arrived at, and flicking through six of them should not
    // leave six entries to back out through.
    window.history.replaceState(null, '', dashboardUrl(hrefs[next]));
  }

  return (
    <div className="flex flex-col gap-2">
      <ValueChart {...series[range]} seriesKey={range} />
      <RangeTabs
        hrefs={hrefs}
        labels={rangeLabels}
        navLabel={navLabel}
        selected={range}
        onSelect={select}
      />
    </div>
  );
}
