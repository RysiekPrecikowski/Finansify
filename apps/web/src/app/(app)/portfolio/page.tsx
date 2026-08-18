import { makeListPositions, type CashBalanceLine, type InstrumentPosition } from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { DataList, type DataListColumn } from '@/components/data-list';
import { OpenPositions } from '@/components/portfolio/open-positions';
import { Monogram, MoneyLines } from '@/components/portfolio/shared';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { getDisplaySettings, getFxPreference } from '@/lib/display/server';
import { formatMoney } from '@/lib/format';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { getInstruments, scopedLedgerFor } from '@/server/container';

/** Shown while `<OpenPositions>` reads storage and, if due, refreshes it — never a spinner over the whole page. */
function OpenPositionsFallback() {
  return (
    <div className="border-border bg-muted/30 flex h-40 animate-pulse items-center justify-center rounded-md border text-sm text-transparent select-none">
      loading
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
 */
export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const ledger = scopedLedgerFor(user.id);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });

  const [view, accounts, dictionary, locale, display, fxPreference] = await Promise.all([
    listPositions(),
    ledger.listAccounts(),
    getDictionary(),
    getLocale(),
    getDisplaySettings(),
    getFxPreference(),
  ]);

  const strings = dictionary.portfolio;

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
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{strings.title}</h1>
        {accounts.length > 0 && (
          <Button size="sm" nativeButton={false} render={<Link href="/transactions/new" />}>
            {dictionary.transactions.add}
          </Button>
        )}
      </div>

      {!hasAnything ? (
        <p className="text-muted-foreground px-1 py-8 text-sm">{empty}</p>
      ) : (
        <>
          {view.open.length > 0 && (
            <Suspense fallback={<OpenPositionsFallback />}>
              <OpenPositions
                positions={view.open}
                locale={locale}
                strings={strings}
                dictionary={dictionary}
                display={display}
                fxPreference={fxPreference}
              />
            </Suspense>
          )}

          {view.closed.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {strings.closed.title}
              </h2>
              <DataList
                rows={view.closed}
                columns={closedColumns}
                rowKey={(position) => position.instrument.id}
                leading={(position) => <Monogram symbol={position.instrument.symbol} />}
                rowHref={rowHref}
              />
            </section>
          )}

          {view.cash.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {strings.cash.title}
              </h2>
              <DataList
                rows={view.cash}
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
