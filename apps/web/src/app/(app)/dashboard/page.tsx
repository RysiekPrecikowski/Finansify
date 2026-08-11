import { AccountTiles } from '@/components/dashboard/account-tiles';
import { AssetClassChips } from '@/components/dashboard/asset-class-chips';
import { HoldingsList } from '@/components/dashboard/holdings-list';
import { PortfolioHeadline } from '@/components/dashboard/portfolio-headline';
import { RangeTabs } from '@/components/dashboard/range-tabs';
import { SortMenu, type SortOption } from '@/components/dashboard/sort-menu';
import { ValueChart } from '@/components/dashboard/value-chart';
import { dashboardHref, parseDashboardParams } from '@/lib/dashboard-params';
import { directionOf, formatMoney } from '@/lib/format';
import { getLocale } from '@/lib/i18n/server';
import { dictionaryFor } from '@/lib/i18n/dictionaries';
import {
  demoPortfolio,
  filterByAssetClass,
  sortHoldings,
  sortOrders,
  type AssetClass,
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

export default async function DashboardPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const [locale, raw] = await Promise.all([getLocale(), searchParams]);
  const dictionary = dictionaryFor(locale);
  const params = parseDashboardParams(raw);

  const snapshot = demoPortfolio;
  const series = snapshot.series[params.range];
  const { high, low } = extremes(series);
  const first = series[0]!.value;
  const last = series[series.length - 1]!.value;

  const present: readonly AssetClass[] = [
    ...new Set(snapshot.holdings.map((holding) => holding.assetClass)),
  ];

  const holdings = sortHoldings(
    filterByAssetClass(snapshot.holdings, params.assetClass),
    params.sort,
  );

  const sortOptions: readonly SortOption[] = sortOrders.map((order) => ({
    order,
    label: dictionary.dashboard.sort[order],
    href: dashboardHref(params, { sort: order }),
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{snapshot.name}</h1>
        <p className="text-muted-foreground text-xs">{dictionary.mock.banner}</p>
      </div>

      <AssetClassChips params={params} present={present} dictionary={dictionary} />

      <PortfolioHeadline snapshot={snapshot} locale={locale} dictionary={dictionary} />

      <div className="flex flex-col gap-2">
        {/* Money becomes plain numbers only here, and only for pixel geometry —
            every figure the user reads is formatted from `Money`. */}
        <ValueChart
          points={series.map((point) => point.value.amount.toNumber())}
          direction={directionOf(last.minus(first))}
          highLabel={formatMoney(high, locale, { bare: true })}
          lowLabel={formatMoney(low, locale, { bare: true })}
          label={`${dictionary.dashboard.totalValue} — ${dictionary.dashboard.ranges[params.range]}`}
        />
        <RangeTabs params={params} dictionary={dictionary} />
      </div>

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
