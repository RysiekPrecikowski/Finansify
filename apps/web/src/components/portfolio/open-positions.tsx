import {
  makeReadFxRates,
  makeReadPrices,
  makeRefreshFxRates,
  makeRefreshPrices,
  Money,
  valuePositions,
  type Currency,
  type InstrumentPosition,
  type ValuedPosition,
} from '@finansify/core';
import type { Route } from 'next';
import type Decimal from 'decimal.js';
import Link from 'next/link';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type DisplaySettings } from '@/lib/display/currencies';
import { currenciesToRefresh, toDisplayCurrencies } from '@/lib/display/server';
import { formatMoney, formatPlainDate, formatQuantity } from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { bondPriceLookups } from '@/server/bond-valuation';
import {
  clock,
  getFxProvider,
  getFxRates,
  getMarketPrices,
  getPriceProvider,
  getSymbols,
} from '@/server/container';

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
}: Readonly<{
  positions: readonly InstrumentPosition[];
  locale: Locale;
  strings: Dictionary['portfolio'];
  dictionary: Dictionary;
  display: DisplaySettings;
}>) {
  // Bonds are deliberately excluded from every price path below. Nothing
  // quotes them (ADR 0011), so asking the provider would be a guaranteed miss
  // per bond per render, and `refreshPrices` would report each one as
  // `unmapped` — which the UI renders as a defect rather than as the normal
  // state of an instrument that is valued by accrual instead.
  const quoted = positions.filter((position) => position.instrument.kind !== 'bond');
  const instrumentIds = quoted.map((position) => position.instrument.id);
  // Instrument currencies (for pricing) union cost-basis currencies (for
  // unrealized P&L) union the currency the reader is totalling in — that last
  // one need not be held by anything, and without a rate for it the total is a
  // partial sum of nothing. `currenciesToRefresh` drops PLN: NBP table A has no
  // PLN row, so including it made `fxDue` permanently true and re-fetched the
  // table on every `/portfolio` render regardless of what was actually stale.
  const currencies = currenciesToRefresh(display, [
    ...quoted.map((position) => position.instrument.currency),
    ...positions.flatMap((position) =>
      position.costBasisByCurrency.map((amount) => amount.currency),
    ),
  ]);

  const readPrices = makeReadPrices({ prices: getMarketPrices(), clock });
  const readFxRates = makeReadFxRates({ fx: getFxRates(), clock });

  let priceLookups = await readPrices(instrumentIds);
  let fxLookups = await readFxRates(currencies);

  const pricesDue = instrumentIds.some((id) => priceLookups.get(id)?.status !== 'fresh');
  const fxDue = currencies.some((code) => fxLookups.get(code)?.status !== 'fresh');

  if (pricesDue) {
    // No mapping pass runs here anymore: `selectInstrument` confirms and
    // saves the provider symbol at the moment an instrument is created
    // (ADR 0014), so every instrument this page can show is already
    // resolved. `refreshPrices`'s `unmapped` report exists for the read
    // path to distinguish from a merely-slow fetch, not because a mapping
    // gap is expected here.
    const refreshPrices = makeRefreshPrices({
      prices: getMarketPrices(),
      symbols: getSymbols(),
      provider: getPriceProvider(),
      clock,
    });
    const report = await refreshPrices(instrumentIds);

    // `readPrices` only ever knows "never-fetched" — it reads
    // `MarketPriceRepository` alone and has no way to tell a merely-slow fetch
    // from one that will never happen without a mapping. `refreshPrices`'s
    // report is the one place that distinction exists, so it's overlaid onto
    // a mutable copy of the fresh read.
    const withUnmapped = new Map(await readPrices(instrumentIds));
    for (const id of report.unmapped) {
      withUnmapped.set(id, { status: 'unavailable', reason: 'unmapped' });
    }
    priceLookups = withUnmapped;
  }

  if (fxDue) {
    const refreshFxRates = makeRefreshFxRates({
      fx: getFxRates(),
      provider: getFxProvider(),
      clock,
    });
    await refreshFxRates(currencies);
    fxLookups = await readFxRates(currencies);
  }

  const ratesToPln = new Map<Currency, Decimal>();
  for (const [code, lookup] of fxLookups) {
    if (lookup.status !== 'unavailable') ratesToPln.set(code, lookup.mid);
  }

  // All the Money arithmetic — market value, unrealized P&L, the portfolio total —
  // lives in `core`'s `valuePositions`, tested against fakes there. This
  // component only formats what it returns.
  // Bond values are accrued, not fetched, and arrive as `PriceLookup`s so the
  // one valuation pipeline serves both kinds — see `server/bond-valuation.ts`.
  const withBonds = new Map(priceLookups);
  for (const [id, lookup] of await bondPriceLookups(positions)) withBonds.set(id, lookup);

  const {
    positions: valued,
    totalMarketValue,
    totalIsComplete,
  } = valuePositions(positions, withBonds, ratesToPln, toDisplayCurrencies(display));

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
