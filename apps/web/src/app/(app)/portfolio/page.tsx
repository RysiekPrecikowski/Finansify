import {
  makeListPositions,
  Money,
  type InstrumentPosition,
  type CashBalanceLine,
} from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { directionOf, directionText, formatMoney, formatQuantity } from '@/lib/format';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';
import { getInstruments, scopedLedgerFor } from '@/server/container';

/** No logo provider yet, so a monogram — never a blank circle. */
function Monogram({ symbol }: Readonly<{ symbol: string }>) {
  return (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold"
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

/**
 * One line per currency — cost basis and realized P&L are never summed across
 * currencies (rule 6/7): inventing a rate to collapse them is exactly what the
 * ledger refuses to do before Phase 2's FX feed exists.
 */
function MoneyLines({
  amounts,
  locale,
  colored = false,
}: Readonly<{ amounts: readonly Money[]; locale: Locale; colored?: boolean }>) {
  return (
    <span className="flex flex-col items-end">
      {amounts.map((amount) => (
        <span
          key={amount.currency}
          className={cn('tabular-nums', colored && directionText[directionOf(amount)])}
        >
          {formatMoney(amount, locale, { signed: colored })}
        </span>
      ))}
    </span>
  );
}

/**
 * The positions view. Ordinary dynamic server read — no `use cache`, because a
 * cached read over user data needs the user id in its key to be safe at all
 * (rule 5, ADR 0010).
 *
 * There is no price feed until Phase 2, so there is no market value, no
 * unrealized P&L and no portfolio weight here — only what the ledger alone
 * supports: quantity, cost basis, realized P&L and cash.
 */
export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const ledger = scopedLedgerFor(user.id);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });

  const [view, accounts, dictionary, locale] = await Promise.all([
    listPositions(),
    ledger.listAccounts(),
    getDictionary(),
    getLocale(),
  ]);

  const strings = dictionary.portfolio;

  const averageCostCell = (position: InstrumentPosition) =>
    position.averageCost === null ? (
      <Badge variant="outline" className="font-normal">
        {strings.multipleCurrencies}
      </Badge>
    ) : (
      formatMoney(Money.of(position.averageCost, position.costBasisByCurrency[0]!.currency), locale)
    );

  const accountsHeldIn = (position: InstrumentPosition) =>
    [...new Set(position.lines.map((line) => line.account.name))].join(', ');

  // `rowHref` on `<DataList>` only wires the mobile card link — the desktop
  // `<table>` has no click-through of its own, same as `/transactions`, so an
  // explicit column is what gives a desktop user a way into the lot detail.
  const rowHref = (position: InstrumentPosition) => `/portfolio/${position.instrument.id}` as Route;

  const openLotsColumn: DataListColumn<InstrumentPosition> = {
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
  };

  const openColumns: readonly DataListColumn<InstrumentPosition>[] = [
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
      id: 'quantity',
      header: strings.quantity,
      align: 'end',
      // Quantity and average cost share one line on a phone, the way a broker
      // app shows them — mirrors the dashboard holdings list.
      mobile: 'subtitle',
      cell: (position) => (
        <>
          <span>{formatQuantity(position.quantity.toFixed(), locale)}</span>
          <span className="text-muted-foreground md:hidden">
            {' · '}
            {averageCostCell(position)}
          </span>
        </>
      ),
    },
    {
      id: 'averageCost',
      header: strings.averageCost,
      align: 'end',
      cell: averageCostCell,
    },
    {
      id: 'costBasis',
      header: strings.costBasis,
      align: 'end',
      mobile: 'value',
      cell: (position) => <MoneyLines amounts={position.costBasisByCurrency} locale={locale} />,
    },
    {
      id: 'realized',
      header: strings.realized,
      align: 'end',
      mobile: 'meta',
      cell: (position) => (
        <MoneyLines amounts={position.realizedByCurrency} locale={locale} colored />
      ),
    },
    {
      id: 'accounts',
      header: strings.accounts,
      cell: (position) => (
        <span className="text-muted-foreground truncate text-xs">{accountsHeldIn(position)}</span>
      ),
    },
    openLotsColumn,
  ];

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
    openLotsColumn,
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
            <DataList
              rows={view.open}
              columns={openColumns}
              rowKey={(position) => position.instrument.id}
              leading={(position) => <Monogram symbol={position.instrument.symbol} />}
              rowHref={rowHref}
            />
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
