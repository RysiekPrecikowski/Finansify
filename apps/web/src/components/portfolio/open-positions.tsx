import {
  Money,
  valuationDivergesFromTax,
  type FxSourcePreference,
  type InstrumentPosition,
  type ValuedPosition,
  type Wrapper,
} from '@finansify/core';
import { Info } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type DisplaySettings } from '@/lib/display/currencies';
import { formatMoney, formatPlainDate, formatQuantity } from '@/lib/format';
import { interpolate, plural, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type AssetClass } from '@/lib/dashboard/snapshot';
import { valuePositionsFor } from '@/server/portfolio-valuation';

import { PositionCard } from './position-card';
import { Monogram, MoneyLines } from './shared';

/**
 * The one network hop the page waits on, and only this section waits on it —
 * everything else in `/portfolio` renders from the ledger alone. Reads what's
 * stored first, refreshes only what's missing or past its TTL, then re-reads
 * (ADR 0014, section 03). A failed refresh never throws here: `refreshPrices`/
 * `refreshFxRates` already swallow provider errors into their report, so a
 * down provider degrades to "stale, with its date shown" rather than an
 * error boundary.
 *
 * **Filtering happens after valuation, not before.** The headline total is the
 * whole portfolio's — a filter narrows the list you are reading, it does not
 * redefine what you own, and a total that moved every time a chip was pressed
 * would be a different (and much less useful) number than the one on the
 * dashboard.
 */
export async function OpenPositions({
  positions,
  assetClass,
  wrapper,
  locale,
  strings,
  dictionary,
  display,
  fxPreference,
}: Readonly<{
  positions: readonly InstrumentPosition[];
  assetClass: AssetClass | null;
  wrapper: Wrapper | null;
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
    // `valuationLookups`, not `priceLookups`: the merged map is the one that
    // carries accrued retail bonds, so a bond row can tell "valued by accrual"
    // apart from "no quote has arrived yet" (see `server/portfolio-valuation.ts`).
    valuationLookups,
    // This page's total is positions only — cash shows in its own table
    // below, unconverted — so there is no cash currency to request a rate for.
  } = await valuePositionsFor(positions, [], display, fxPreference);

  const shown = valued.filter((position) => {
    if (assetClass !== null && position.instrument.kind !== assetClass) return false;
    if (wrapper !== null && !position.lines.some((line) => line.account.wrapper === wrapper)) {
      return false;
    }
    return true;
  });

  const unpricedCount = shown.filter(
    (position) => position.marketValueByCurrency.length === 0,
  ).length;

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
    const lookup = valuationLookups.get(position.instrument.id);

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
        {/* A retail bond is never quoted, so it never goes stale in the sense
            this line means — it says where its value came from instead
            (`components/portfolio/position-card.tsx` explains the split). */}
        {position.instrument.kind === 'bond' ? (
          <span className="text-muted-foreground text-[0.7rem]">{strings.accrualNote}</span>
        ) : (
          lookup?.status === 'stale' && (
            <span className="text-muted-foreground text-[0.7rem]">
              {dictionary.dashboard.asOf} {formatPlainDate(lookup.asOf, locale)} ·{' '}
              {dictionary.dashboard.stale}
            </span>
          )
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
      cell: (position) => formatQuantity(position.quantity.toFixed(), locale),
    },
    { id: 'averageCost', header: strings.averageCost, align: 'end', cell: averageCostCell },
    { id: 'marketValue', header: strings.marketValue, align: 'end', cell: marketValueCell },
    { id: 'unrealized', header: strings.unrealized, align: 'end', cell: unrealizedCell },
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

  return (
    <div className="flex flex-col gap-4">
      {/* The headline, as the artboard has it: label and value, then the two
          real caveats this app already owned — what the total covers, and
          whether it is complete. Neither is decoration: dropping the second
          would render a partial sum as though it were the whole figure. */}
      <section className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {strings.totalValue}
        </span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
          {formatMoney(totalMarketValue, locale)}
        </span>

        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {interpolate(strings.totalValueNote, { currency: display.total })}
        </p>
        {valuationDivergesFromTax(fxPreference) && (
          <p className="text-muted-foreground text-xs">{strings.totalValueMarket}</p>
        )}
        {!totalIsComplete && (
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {strings.totalValueIncomplete}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {strings.openTitle}
          </h2>
          <span className="text-muted-foreground/70 text-[0.6875rem] tabular-nums">
            {plural(strings.positionCount, shown.length, locale)}
            {unpricedCount > 0 &&
              ` · ${interpolate(strings.withoutPrice, { count: String(unpricedCount) })}`}
          </span>
        </div>

        <DataList
          rows={shown}
          columns={columns}
          rowKey={(position) => position.instrument.id}
          leading={(position) => <Monogram symbol={position.instrument.symbol} />}
          empty={strings.noResults}
          mobileCard={(position) => (
            <PositionCard
              position={position}
              lookup={valuationLookups.get(position.instrument.id)}
              href={rowHref(position)}
              locale={locale}
              dictionary={dictionary}
            />
          )}
        />
      </section>
    </div>
  );
}
