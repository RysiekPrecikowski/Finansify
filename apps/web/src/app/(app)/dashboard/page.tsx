import { AccountTiles } from '@/components/dashboard/account-tiles';
import { AssetClassChips } from '@/components/dashboard/asset-class-chips';
import { ChartCard } from '@/components/dashboard/chart-card';
import { HoldingsList } from '@/components/dashboard/holdings-list';
import { PortfolioHeadline } from '@/components/dashboard/portfolio-headline';
import { SortMenu, type SortOption } from '@/components/dashboard/sort-menu';
import { chartPointCount, resample, type ChartSeries } from '@/lib/chart-series';
import { parseDashboardParams } from '@/lib/dashboard-params';
import { directionOf, formatMoney } from '@/lib/format';
import { getLocale } from '@/lib/i18n/server';
import { type Locale } from '@/lib/i18n/locales';
import { dictionaryFor } from '@/lib/i18n/dictionaries';
import {
  demoPortfolio,
  filterByAssetClass,
  ranges,
  sortHoldings,
  sortOrders,
  type AssetClass,
  type Range,
  type ValuePoint,
} from '@/lib/fixtures/portfolio';
import { type Money } from '@finansify/core';

function extremes(points: readonly ValuePoint[]): { high: Money; low: Money } {
  return points.reduce<{ high: Money; low: Money }>(
    (bounds, point) => ({
      high: point.value.greaterThan(bounds.high) ? point.value : bounds.high,
      low: point.value.lessThan(bounds.low) ? point.value : bounds.low,
    }),
    { high: points[0]!.value, low: points[0]!.value },
  );
}

/**
 * `Object.fromEntries` widens to a string index signature, and the six ranges
 * are exactly known — the assertion restores what the input already guarantees.
 */
function byRange<T>(build: (range: Range) => T): Record<Range, T> {
  return Object.fromEntries(ranges.map((range) => [range, build(range)])) as Record<Range, T>;
}

/**
 * Every range is prepared on the server so the client can switch between them
 * without a round trip. `Money` and `Intl` stay on this side: the client
 * receives finished strings and pixel geometry, never a currency value.
 *
 * The high and low labels come from the **true** series, not the resampled one
 * — resampling is for the tween's benefit and must not reach a figure the user
 * reads.
 */
function chartSeriesFor(
  points: readonly ValuePoint[],
  rangeLabel: string,
  valueLabel: string,
  locale: Locale,
): ChartSeries {
  const { high, low } = extremes(points);
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;

  return {
    // Money becomes plain numbers only here, and only for pixel geometry —
    // every figure the user reads is formatted from `Money` above.
    points: resample(
      points.map((point) => point.value.amount.toNumber()),
      chartPointCount,
    ),
    direction: directionOf(last.minus(first)),
    highLabel: formatMoney(high, locale, { bare: true }),
    lowLabel: formatMoney(low, locale, { bare: true }),
    label: `${valueLabel} — ${rangeLabel}`,
  };
}

export default async function DashboardPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const [locale, raw] = await Promise.all([getLocale(), searchParams]);
  const dictionary = dictionaryFor(locale);
  const params = parseDashboardParams(raw);

  const snapshot = demoPortfolio;

  const chartSeries = byRange((range) =>
    chartSeriesFor(
      snapshot.series[range],
      dictionary.dashboard.ranges[range],
      dictionary.dashboard.totalValue,
      locale,
    ),
  );
  const present: readonly AssetClass[] = [
    ...new Set(snapshot.holdings.map((holding) => holding.assetClass)),
  ];

  const holdings = sortHoldings(
    filterByAssetClass(snapshot.holdings, params.assetClass),
    params.sort,
  );

  // Labels only: each option's href is built on the client from the live params,
  // so it keeps a range switched to since this render (`lib/use-dashboard-params`).
  const sortOptions: readonly SortOption[] = sortOrders.map((order) => ({
    order,
    label: dictionary.dashboard.sort[order],
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{snapshot.name}</h1>
        <p className="text-muted-foreground text-xs">{dictionary.mock.banner}</p>
      </div>

      <AssetClassChips present={present} dictionary={dictionary} />

      <PortfolioHeadline snapshot={snapshot} locale={locale} dictionary={dictionary} />

      <ChartCard
        series={chartSeries}
        rangeLabels={dictionary.dashboard.ranges}
        navLabel={dictionary.dashboard.chartRange}
      />

      <AccountTiles accounts={snapshot.accounts} locale={locale} dictionary={dictionary} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {dictionary.dashboard.holdings.title}
          </h2>
          <SortMenu options={sortOptions} selected={params.sort} label={dictionary.actions.sort} />
        </div>

        <HoldingsList
          holdings={holdings}
          total={snapshot.totalValue}
          locale={locale}
          dictionary={dictionary}
        />
      </section>
    </div>
  );
}
