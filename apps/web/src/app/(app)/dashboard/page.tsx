import {
  currency as toCurrency,
  makeListPositions,
  type Account,
  type CashBalanceLine,
  type FxSourcePreference,
  type InstrumentId,
  type InstrumentPosition,
  type PriceLookup,
  type Temporal,
  type UserId,
} from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AccountTiles } from '@/components/dashboard/account-tiles';
import { AssetClassChips } from '@/components/dashboard/asset-class-chips';
import { ChartCard } from '@/components/dashboard/chart-card';
import { HoldingsList } from '@/components/dashboard/holdings-list';
import { MarketSnapshot } from '@/components/dashboard/market-snapshot';
import { NewsList } from '@/components/dashboard/news-list';
import { PortfolioHeadline } from '@/components/dashboard/portfolio-headline';
import { SectorBreakdown } from '@/components/dashboard/sector-breakdown';
import { SortMenu, type SortOption } from '@/components/dashboard/sort-menu';
import { TopMovers } from '@/components/dashboard/top-movers';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import {
  buildAccountTotals,
  buildDashboardHoldings,
  buildTotals,
  filterByAssetClass,
  sortHoldings,
  sortOrders,
  type AssetClass,
  type SortOrder,
} from '@/lib/dashboard/snapshot';
import { parseDashboardParams, type Range } from '@/lib/dashboard-params';
import { type DisplaySettings } from '@/lib/display/currencies';
import { getDisplaySettings, getFxPreference } from '@/lib/display/server';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { type Locale } from '@/lib/i18n/locales';
import { formatInstant } from '@/lib/format';
import { clock, getInstruments, scopedLedgerFor } from '@/server/container';
import { valuePositionsFor } from '@/server/portfolio-valuation';
import { readValueSeries, toApiValueSeriesResponse } from '@/server/value-series';

/**
 * When the prices behind this render were last fetched — the most recent
 * `fetchedAt` across every instrument that has one.
 *
 * The *newest* rather than the oldest: this line answers "how current is this
 * screen", and the oldest reading belongs to whichever instrument is most
 * stale, which is a per-position fact `/portfolio` already shows per row. A
 * portfolio with nothing quoted (all retail bonds, which are accrued rather
 * than priced — ADR 0011) has no timestamp at all, and gets `null` rather than
 * `now()` dressed up as a data timestamp.
 */
function latestFetchedAt(lookups: ReadonlyMap<InstrumentId, PriceLookup>): Temporal.Instant | null {
  let latest: Temporal.Instant | null = null;
  for (const lookup of lookups.values()) {
    if (lookup.status === 'unavailable') continue;
    if (latest === null || lookup.fetchedAt.epochMilliseconds > latest.epochMilliseconds) {
      latest = lookup.fetchedAt;
    }
  }
  return latest;
}

/** Shown while `<DashboardSections>` reads storage and, if due, refreshes it — never a spinner over the whole page. */
function DashboardSectionsFallback() {
  return (
    <div className="flex flex-col gap-6">
      <div className="border-border bg-muted/30 h-32 animate-pulse rounded-md border" />
      <div className="border-border bg-muted/30 h-48 animate-pulse rounded-md border" />
    </div>
  );
}

/** Same footprint as `<MarketSnapshot>`'s "brick" grid, so it doesn't jump into place once the FX/GUS reads resolve. */
function MarketSnapshotFallback() {
  return (
    <div className="grid grid-cols-6 gap-3" aria-hidden="true">
      <div className="bg-muted/30 col-span-2 h-[4.5rem] animate-pulse rounded-xl" />
      <div className="bg-muted/30 col-span-2 h-[4.5rem] animate-pulse rounded-xl" />
      <div className="bg-muted/30 col-span-2 h-[4.5rem] animate-pulse rounded-xl" />
      <div className="bg-muted/30 col-span-3 h-[4.5rem] animate-pulse rounded-xl" />
      <div className="bg-muted/30 col-span-3 h-[4.5rem] animate-pulse rounded-xl" />
    </div>
  );
}

/**
 * Everything that needs a price or an FX rate: headline, allocation, holdings,
 * account tiles. Streamed in on its own `<Suspense>` boundary so a slow or
 * down provider only ever delays this section, never the page — same split as
 * `/portfolio`'s `<OpenPositions>` (ADR 0014, section 03).
 */
async function DashboardSections({
  userId,
  open,
  cash,
  accounts,
  display,
  fxPreference,
  sort,
  assetClass,
  range,
  locale,
  dictionary,
}: Readonly<{
  userId: UserId;
  open: readonly InstrumentPosition[];
  cash: readonly CashBalanceLine[];
  accounts: readonly Account[];
  display: DisplaySettings;
  fxPreference: FxSourcePreference;
  sort: SortOrder;
  assetClass: AssetClass | null;
  range: Range;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const total = toCurrency(display.total);

  // The hero chart reads storage only (`readValueSeries`, no network) and
  // doesn't touch `valuePositionsFor`'s price/FX refresh at all, so running it
  // in parallel rather than after adds essentially nothing to this section's
  // own wait — it resolves at `max(valuation, series)`, not their sum.
  const [{ valuation, priceLookups, valuationLookups, ratesToPln }, series] = await Promise.all([
    // Every dashboard row is a single `Money`, never an array of them —
    // `lines` is pinned to the presentation total regardless of what the
    // reader picked for `/portfolio`'s detailed, per-line-currency table.
    valuePositionsFor(open, cash, display, fxPreference, { total, lines: total }),
    readValueSeries(userId, { range, grain: null, presentIn: total }),
  ]);

  const totals = buildTotals(valuation.positions, valuation, ratesToPln, total);
  const allHoldings = buildDashboardHoldings(valuation.positions, priceLookups);
  const present: readonly AssetClass[] = [
    ...new Set(allHoldings.map((holding) => holding.assetClass)),
  ];
  const holdings = sortHoldings(filterByAssetClass(allHoldings, assetClass), sort);
  // The contribution year comes from the clock here rather than inside
  // `buildAccountTotals`, which stays pure — see its `year` parameter.
  const year = clock.now().toZonedDateTimeISO('Europe/Warsaw').year;
  const accountTiles = buildAccountTotals(
    accounts,
    valuation.positions,
    cash,
    ratesToPln,
    total,
    year,
  );
  // `valuationLookups`, not `priceLookups`: an all-bond portfolio is valued
  // entirely from accruals, and reading the quote-only map would report no
  // timestamp for a page full of numbers.
  const fetchedAt = latestFetchedAt(valuationLookups);

  const sortOptions: readonly SortOption[] = sortOrders.map((order) => ({
    order,
    label: dictionary.dashboard.sort[order],
  }));

  return (
    <>
      <AssetClassChips present={present} dictionary={dictionary} />

      <PortfolioHeadline
        totals={totals}
        asOf={fetchedAt === null ? null : formatInstant(fetchedAt, locale)}
        locale={locale}
        dictionary={dictionary}
      />

      <ChartCard
        initialRange={range}
        initialResponse={toApiValueSeriesResponse(series)}
        rangeLabels={dictionary.dashboard.ranges}
        navLabel={dictionary.dashboard.chartRange}
        ariaLabel={dictionary.dashboard.chart.ariaLabel}
        loadingLabel={dictionary.dashboard.chart.loadingHistory}
        unsupportedRangeLabel={dictionary.dashboard.chart.unsupportedRange}
      />

      <AccountTiles accounts={accountTiles} locale={locale} dictionary={dictionary} />

      {/* Own `<Suspense>` boundary: a slow FX or GUS upstream should delay
          only this card, never the already-resolved valuation below it. */}
      <Suspense fallback={<MarketSnapshotFallback />}>
        <MarketSnapshot locale={locale} dictionary={dictionary} />
      </Suspense>

      <TopMovers holdings={allHoldings} locale={locale} dictionary={dictionary} />

      <SectorBreakdown
        holdings={allHoldings}
        total={totals.totalValue}
        locale={locale}
        dictionary={dictionary}
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {dictionary.dashboard.holdings.title}
          </h2>
          <SortMenu options={sortOptions} selected={sort} label={dictionary.actions.sort} />
        </div>

        <HoldingsList
          holdings={holdings}
          total={totals.totalValue}
          locale={locale}
          dictionary={dictionary}
        />
      </section>

      <NewsList holdings={allHoldings} dictionary={dictionary} />
    </>
  );
}

export default async function DashboardPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const [locale, raw, display, fxPreference, dictionary] = await Promise.all([
    getLocale(),
    searchParams,
    getDisplaySettings(),
    getFxPreference(),
    getDictionary(),
  ]);
  const params = parseDashboardParams(raw);

  const ledger = scopedLedgerFor(user.id);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });

  const [view, accounts] = await Promise.all([listPositions(), ledger.listAccounts()]);

  const empty =
    accounts.length === 0 ? (
      <span className="flex flex-col items-start gap-2">
        {dictionary.transactions.needsAccount}
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/accounts" />}>
          {dictionary.accounts.add}
        </Button>
      </span>
    ) : (
      <span className="flex flex-col items-start gap-2">
        {dictionary.dashboard.holdings.empty}
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/transactions/new" />}
        >
          {dictionary.transactions.add}
        </Button>
      </span>
    );

  return (
    // No page `<h1>`: the header bar carries the screen name now
    // (`components/header-title.tsx`), so repeating it here would be the same
    // two-title stack the redesign collapsed.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {view.open.length === 0 && accounts.length === 0 ? (
        <p className="text-muted-foreground px-1 py-8 text-sm">{empty}</p>
      ) : (
        <Suspense fallback={<DashboardSectionsFallback />}>
          <DashboardSections
            userId={user.id}
            open={view.open}
            cash={view.cash}
            accounts={accounts}
            display={display}
            fxPreference={fxPreference}
            sort={params.sort}
            assetClass={params.assetClass}
            range={params.range}
            locale={locale}
            dictionary={dictionary}
          />
        </Suspense>
      )}
    </div>
  );
}
