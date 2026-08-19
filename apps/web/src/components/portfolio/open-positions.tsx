import {
  Money,
  valuationDivergesFromTax,
  type FxSourcePreference,
  type InstrumentPosition,
  type ValuedPosition,
} from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type DisplaySettings } from '@/lib/display/currencies';
import { formatMoney, formatPlainDate, formatQuantity } from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { valuePositionsFor } from '@/server/portfolio-valuation';

import { Monogram, MoneyLines } from './shared';

/**
 * The one network hop the page waits on, and only this section waits on it —
 * everything else in `/portfolio` renders from the ledger alone. Reads what's
 * stored first, refreshes only what's missing or past its TTL, then re-reads
 * (ADR 0014, section 03). A failed refresh never throws here: `refreshPrices`/
 * `refreshFxRates` already swallow provider errors into their report, so a
 * down provider degrades to "stale, with its date shown" rather than an
 * error boundary.
 */
export async function OpenPositions({
  positions,
  locale,
  strings,
  dictionary,
  display,
  fxPreference,
}: Readonly<{
  positions: readonly InstrumentPosition[];
  locale: Locale;
  strings: Dictionary['portfolio'];
  dictionary: Dictionary;
  display: DisplaySettings;
  /** Which FX feed values this page, and how far the reader scoped that choice (ADR 0018). */
  fxPreference: FxSourcePreference;
}>) {
  // All the Money arithmetic — market value, unrealized P&L, the portfolio
  // total — lives in `core`'s `valuePositions`, tested against fakes there.
  // This component only formats what it returns. `valuePositionsFor` is the
  // read/refresh/re-read pipeline shared with `/dashboard`.
  const {
    valuation: { positions: valued, totalMarketValue, totalIsComplete },
    priceLookups,
  } = await valuePositionsFor(positions, display, fxPreference);

  const averageCostCell = (position: ValuedPosition) =>
    position.averageCost === null ? (
      <Badge variant="outline" className="font-normal">
        {strings.multipleCurrencies}
      </Badge>
    ) : (
      formatMoney(Money.of(position.averageCost, position.costBasisByCurrency[0]!.currency), locale)
    );

  const accountsHeldIn = (position: ValuedPosition) =>
    [...new Set(position.lines.map((line) => line.account.name))].join(', ');

  const rowHref = (position: ValuedPosition) => `/portfolio/${position.instrument.id}` as Route;

  const marketValueCell = (position: ValuedPosition) => {
    const lookup = priceLookups.get(position.instrument.id);

    if (position.marketValueByCurrency.length === 0) {
      const reason = lookup?.status === 'unavailable' ? lookup.reason : 'never-fetched';
      return (
        <span className="text-muted-foreground text-xs">
          {reason === 'unmapped' ? strings.unavailableUnmapped : strings.unavailableNeverFetched}
        </span>
      );
    }

    return (
      <span className="flex flex-col items-end">
        <MoneyLines amounts={position.marketValueByCurrency} locale={locale} />
        {lookup?.status === 'stale' && (
          <span className="text-muted-foreground text-[0.7rem]">
            {dictionary.dashboard.asOf} {formatPlainDate(lookup.asOf, locale)} ·{' '}
            {dictionary.dashboard.stale}
          </span>
        )}
      </span>
    );
  };

  const unrealizedCell = (position: ValuedPosition) =>
    position.unrealizedByCurrency.length === 0 ? (
      <span className="text-muted-foreground text-xs">—</span>
    ) : (
      <MoneyLines amounts={position.unrealizedByCurrency} locale={locale} colored />
    );

  const openLotsColumn: DataListColumn<ValuedPosition> = {
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

  const columns: readonly DataListColumn<ValuedPosition>[] = [
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
    { id: 'averageCost', header: strings.averageCost, align: 'end', cell: averageCostCell },
    {
      id: 'marketValue',
      header: strings.marketValue,
      align: 'end',
      mobile: 'value',
      cell: marketValueCell,
    },
    {
      id: 'unrealized',
      header: strings.unrealized,
      align: 'end',
      mobile: 'meta',
      cell: unrealizedCell,
    },
    {
      id: 'costBasis',
      header: strings.costBasis,
      align: 'end',
      cell: (position) => <MoneyLines amounts={position.costBasisByCurrency} locale={locale} />,
    },
    {
      id: 'realized',
      header: strings.realized,
      align: 'end',
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {strings.totalValue}
        </span>
        <span className="flex flex-col items-end">
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(totalMarketValue, locale)}
          </span>
          <span className="text-muted-foreground text-[0.7rem]">
            {interpolate(strings.totalValueNote, { currency: display.total })}
          </span>
          {valuationDivergesFromTax(fxPreference) && (
            <span className="text-muted-foreground text-[0.7rem]">{strings.totalValueMarket}</span>
          )}
          {!totalIsComplete && (
            <span className="text-muted-foreground text-[0.7rem]">
              {strings.totalValueIncomplete}
            </span>
          )}
        </span>
      </div>
      <DataList
        rows={valued}
        columns={columns}
        rowKey={(position) => position.instrument.id}
        leading={(position) => <Monogram symbol={position.instrument.symbol} />}
        rowHref={rowHref}
      />
    </div>
  );
}
