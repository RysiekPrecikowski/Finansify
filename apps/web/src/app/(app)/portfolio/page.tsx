import {
  makeListPositions,
  wrappers,
  type CashBalanceLine,
  type InstrumentPosition,
} from '@finansify/core';
import { Plus } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { DataList, type DataListColumn } from '@/components/data-list';
import { FilterChips, type FilterChip } from '@/components/filter-chips';
import { OpenPositions } from '@/components/portfolio/open-positions';
import { Monogram, MoneyLines } from '@/components/portfolio/shared';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { assetClasses, type AssetClass } from '@/lib/dashboard/snapshot';
import { getDisplaySettings, getFxPreference } from '@/lib/display/server';
import { formatMoney } from '@/lib/format';
import { plural } from '@/lib/i18n/dictionaries';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { loadPositions } from '@/lib/positions';
import { parsePortfolioParams, portfolioHref } from '@/lib/portfolio-params';
import { getInstruments, scopedLedgerFor } from '@/server/container';

/** Shown while `<OpenPositions>` reads storage and, if due, refreshes it — never a spinner over the whole page. */
function OpenPositionsFallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/30 h-24 animate-pulse rounded-md" />
      <div className="bg-muted/30 h-48 animate-pulse rounded-md" />
    </div>
  );
}

/**
 * The positions view. Ordinary dynamic server read — no `use cache`, because a
 * cached read over user data needs the user id in its key to be safe at all
 * (rule 5, ADR 0010).
 *
 * Open positions carry market value and unrealized P&L, streamed in by
 * `<OpenPositions>`'s own `<Suspense>` boundary (ADR 0014, section 03) — the
 * ledger read below never touches a price or an FX rate itself, so a slow or
 * down provider only ever delays that one section, never the page.
 *
 * Both filters are URL parameters read here and handed down, never client
 * state (`lib/portfolio-params.ts`).
 */
export default async function PortfolioPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const ledger = scopedLedgerFor(user.id);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });

  const [positions, accounts, dictionary, locale, display, fxPreference, raw] = await Promise.all([
    loadPositions(listPositions),
    ledger.listAccounts(),
    getDictionary(),
    getLocale(),
    getDisplaySettings(),
    getFxPreference(),
    searchParams,
  ]);

  const strings = dictionary.portfolio;
  const params = parsePortfolioParams(raw);

  if (!positions.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground px-1 py-8 text-sm">{strings.mixedCurrencyError}</p>
      </div>
    );
  }
  const view = positions.view;

  // `rowHref` on `<DataList>` only wires the mobile card link — the desktop
  // `<table>` has no click-through of its own, same as `/transactions`, so an
  // explicit column is what gives a desktop user a way into the lot detail.
  const rowHref = (position: InstrumentPosition) => `/portfolio/${position.instrument.id}` as Route;

  const closedColumns: readonly DataListColumn<InstrumentPosition>[] = [
    {
      id: 'instrument',
      header: strings.instrument,
      mobile: 'title',
      cell: (position) => (
        <span className="flex flex-col">
          <span className="font-medium">{position.instrument.symbol}</span>
          <span className="text-muted-foreground truncate text-xs">{position.instrument.name}</span>
        </span>
      ),
    },
    {
      id: 'realized',
      header: strings.realized,
      align: 'end',
      mobile: 'value',
      cell: (position) => (
        <MoneyLines amounts={position.realizedByCurrency} locale={locale} colored />
      ),
    },
    {
      id: 'lots',
      header: '',
      align: 'end',
      cell: (position) => (
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href={rowHref(position)} />}
        >
          {strings.lots.title}
        </Button>
      ),
    },
  ];

  const cashColumns: readonly DataListColumn<CashBalanceLine>[] = [
    {
      id: 'account',
      header: strings.cash.account,
      mobile: 'title',
      cell: (line) => (
        <span className="flex flex-col">
          <span className="font-medium">{line.account.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {dictionary.wrappers[line.account.wrapper]}
          </span>
        </span>
      ),
    },
    {
      id: 'amount',
      header: dictionary.transactions.amount,
      align: 'end',
      mobile: 'value',
      cell: (line) => formatMoney(line.amount, locale),
    },
  ];

  // Only classes and wrappers actually held get a chip — an empty filter is a
  // dead end, the same rule the dashboard's chips already follow.
  const heldClasses = new Set(view.open.map((position) => position.instrument.kind));
  const heldWrappers = new Set(
    view.open.flatMap((position) => position.lines.map((line) => line.account.wrapper)),
  );

  const classChips: readonly FilterChip<AssetClass>[] = [
    {
      value: null,
      label: dictionary.dashboard.assetClasses.all,
      href: portfolioHref(params, { assetClass: null }),
    },
    ...assetClasses
      .filter((assetClass) => heldClasses.has(assetClass))
      .map((assetClass) => ({
        value: assetClass,
        label: dictionary.dashboard.assetClasses[assetClass],
        href: portfolioHref(params, { assetClass }),
      })),
  ];

  const wrapperChips: readonly FilterChip<(typeof wrappers)[number]>[] = [
    { value: null, label: strings.allWrappers, href: portfolioHref(params, { wrapper: null }) },
    ...wrappers
      .filter((wrapper) => heldWrappers.has(wrapper))
      .map((wrapper) => ({
        value: wrapper,
        label: dictionary.wrappers[wrapper],
        href: portfolioHref(params, { wrapper }),
      })),
  ];

  // Cash is listed per account *and* currency — one account holding both PLN
  // and USD is two balances, never one summed at an invented rate (rule 6).
  const cashRows = [...view.cash].sort(
    (left, right) =>
      left.account.name.localeCompare(right.account.name) ||
      left.amount.currency.localeCompare(right.amount.currency),
  );

  const hasAnything = view.open.length > 0 || view.closed.length > 0 || view.cash.length > 0;

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {!hasAnything ? (
        <p className="text-muted-foreground px-1 py-8 text-sm">{empty}</p>
      ) : (
        <>
          {accounts.length > 0 && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/transactions/new" />}
              className="w-fit gap-1.5 rounded-full"
            >
              <Plus className="size-4" aria-hidden />
              {dictionary.transactions.add}
            </Button>
          )}

          {/* Two dimensions, two rows, one chip style. Both are structure the
              ledger already has — the instrument's kind and the account's tax
              wrapper — rather than a new "custom portfolio" concept. Stacked
              rather than merged into one row: at 390 px a single row of eight
              chips wraps into an unreadable block, and the two answer
              different questions. */}
          {view.open.length > 0 && (classChips.length > 2 || wrapperChips.length > 2) && (
            <div className="flex flex-col gap-2">
              {classChips.length > 2 && (
                <FilterChips
                  label={dictionary.dashboard.filterByAssetClass}
                  chips={classChips}
                  selected={params.assetClass}
                />
              )}
              {wrapperChips.length > 2 && (
                <FilterChips
                  label={strings.filterByWrapper}
                  chips={wrapperChips}
                  selected={params.wrapper}
                />
              )}
            </div>
          )}

          {view.open.length > 0 && (
            <Suspense
              key={`${params.assetClass ?? 'all'}:${params.wrapper ?? 'all'}`}
              fallback={<OpenPositionsFallback />}
            >
              <OpenPositions
                positions={view.open}
                assetClass={params.assetClass}
                wrapper={params.wrapper}
                locale={locale}
                strings={strings}
                dictionary={dictionary}
                display={display}
                fxPreference={fxPreference}
              />
            </Suspense>
          )}

          {view.closed.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {strings.closed.title}
                </h2>
                <span className="text-muted-foreground/70 text-[0.6875rem] tabular-nums">
                  {plural(strings.positionCount, view.closed.length, locale)}
                </span>
              </div>
              <DataList
                rows={view.closed}
                columns={closedColumns}
                rowKey={(position) => position.instrument.id}
                leading={(position) => <Monogram symbol={position.instrument.symbol} />}
                rowHref={rowHref}
              />
            </section>
          )}

          {cashRows.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {strings.cash.title}
                </h2>
                <span className="text-muted-foreground/70 text-[0.6875rem] tabular-nums">
                  {plural(strings.balanceCount, cashRows.length, locale)}
                </span>
              </div>
              <DataList
                rows={cashRows}
                columns={cashColumns}
                rowKey={(line) => `${line.account.id}::${line.amount.currency}`}
              />
              <p className="text-muted-foreground text-xs">{strings.cash.note}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
