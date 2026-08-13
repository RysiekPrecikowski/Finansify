import {
  convertViaPln,
  makeMapInstrument,
  makeReadFxRates,
  makeReadPrices,
  makeRefreshFxRates,
  makeRefreshPrices,
  Money,
  UnknownFxRateError,
  currency as toCurrency,
  type Currency,
  type InstrumentPosition,
} from '@finansify/core';
import type { Route } from 'next';
import type Decimal from 'decimal.js';
import Link from 'next/link';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatMoney, formatPlainDate, formatQuantity } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import {
  clock,
  getFxProvider,
  getFxRates,
  getMarketPrices,
  getPriceProvider,
  getSymbolResolver,
  getSymbols,
} from '@/server/container';

import { Monogram, MoneyLines } from './shared';

const PLN = toCurrency('PLN');

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
}: Readonly<{
  positions: readonly InstrumentPosition[];
  locale: Locale;
  strings: Dictionary['portfolio'];
  dictionary: Dictionary;
}>) {
  const instrumentIds = positions.map((position) => position.instrument.id);
  const currencies = [...new Set(positions.map((position) => position.instrument.currency))];

  const readPrices = makeReadPrices({ prices: getMarketPrices(), clock });
  const readFxRates = makeReadFxRates({ fx: getFxRates(), clock });

  let priceLookups = await readPrices(instrumentIds);
  let fxLookups = await readFxRates(currencies);

  const pricesDue = instrumentIds.some((id) => priceLookups.get(id)?.status !== 'fresh');
  const fxDue = currencies.some((code) => fxLookups.get(code)?.status !== 'fresh');

  if (pricesDue) {
    // A never-before-seen instrument has no row in `instrument_identifiers`
    // yet, and `refreshPrices` skips anything unmapped rather than guessing —
    // so mapping runs first. Already-mapped instruments cost one cheap DB
    // read here and nothing else (`makeMapInstrument` never re-resolves).
    // A refusal (currency/exchange mismatch, no MIC on file) is not an error
    // to surface here — it's exactly what queues an instrument for PR 6's
    // manual mapping screen.
    await resolveMissingSymbols(positions);

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

  let total = Money.zero(PLN);
  let totalIncomplete = false;

  const marketValueOf = (position: InstrumentPosition): Money | null => {
    const lookup = priceLookups.get(position.instrument.id);
    if (lookup === undefined || lookup.status === 'unavailable') return null;
    return lookup.close.times(position.quantity);
  };

  for (const position of positions) {
    const value = marketValueOf(position);
    if (value === null) {
      totalIncomplete = true;
      continue;
    }
    try {
      total = total.plus(convertViaPln(value, PLN, ratesToPln));
    } catch (error) {
      if (error instanceof UnknownFxRateError) totalIncomplete = true;
      else throw error;
    }
  }

  const unrealizedOf = (position: InstrumentPosition): Money | null => {
    const value = marketValueOf(position);
    if (value === null) return null;
    // Only computed when cost basis is single-currency and matches the
    // instrument's own currency — a cost basis split across accounts in
    // different currencies has no single number to subtract from (rule 6/7,
    // same reasoning as `averageCost`).
    if (position.costBasisByCurrency.length !== 1) return null;
    const costBasis = position.costBasisByCurrency[0]!;
    if (costBasis.currency !== value.currency) return null;
    return value.minus(costBasis);
  };

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

  const rowHref = (position: InstrumentPosition) => `/portfolio/${position.instrument.id}` as Route;

  const marketValueCell = (position: InstrumentPosition) => {
    const value = marketValueOf(position);
    const lookup = priceLookups.get(position.instrument.id);

    if (value === null) {
      const reason = lookup?.status === 'unavailable' ? lookup.reason : 'never-fetched';
      return (
        <span className="text-muted-foreground text-xs">
          {reason === 'unmapped' ? strings.unavailableUnmapped : strings.unavailableNeverFetched}
        </span>
      );
    }

    return (
      <span className="flex flex-col items-end">
        <span className="tabular-nums">{formatMoney(value, locale)}</span>
        {lookup?.status === 'stale' && (
          <span className="text-muted-foreground text-[0.7rem]">
            {dictionary.dashboard.asOf} {formatPlainDate(lookup.asOf, locale)} ·{' '}
            {dictionary.dashboard.stale}
          </span>
        )}
      </span>
    );
  };

  const unrealizedCell = (position: InstrumentPosition) => {
    const value = unrealizedOf(position);
    return value === null ? (
      <span className="text-muted-foreground text-xs">—</span>
    ) : (
      <MoneyLines amounts={[value]} locale={locale} colored />
    );
  };

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

  const columns: readonly DataListColumn<InstrumentPosition>[] = [
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
          <span className="text-lg font-semibold tabular-nums">{formatMoney(total, locale)}</span>
          {totalIncomplete && (
            <span className="text-muted-foreground text-[0.7rem]">{strings.totalValueNote}</span>
          )}
        </span>
      </div>
      <DataList
        rows={positions}
        columns={columns}
        rowKey={(position) => position.instrument.id}
        leading={(position) => <Monogram symbol={position.instrument.symbol} />}
        rowHref={rowHref}
      />
    </div>
  );
}

/** Auto-maps whatever isn't mapped yet; a refusal from the resolver is not an error here. */
async function resolveMissingSymbols(positions: readonly InstrumentPosition[]): Promise<void> {
  const mapInstrument = makeMapInstrument({ symbols: getSymbols(), resolver: getSymbolResolver() });
  for (const position of positions) {
    await mapInstrument(position.instrument);
  }
}
