import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { type DashboardHolding } from '@/lib/dashboard/snapshot';
import {
  directionOf,
  directionSurface,
  formatMoney,
  formatQuantity,
  formatRatioAsPercent,
} from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type Money } from '@finansify/core';
import { cn } from '@/lib/utils';

/** No logo provider yet, so a monogram — never a blank circle. */
function Monogram({ holding }: Readonly<{ holding: DashboardHolding }>) {
  return (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold"
    >
      {holding.symbol.slice(0, 3)}
    </span>
  );
}

function GainBadge({ holding, locale }: Readonly<{ holding: DashboardHolding; locale: Locale }>) {
  if (holding.valuation === null || holding.valuation.gain === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const gain = holding.valuation.gain;
  const gainRatio = holding.valuation.gainRatio;
  const direction = directionOf(gain);

  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span
        className={cn(
          'tabular-nums',
          direction === 'up'
            ? 'text-gain'
            : direction === 'down'
              ? 'text-loss'
              : 'text-muted-foreground',
        )}
      >
        {formatMoney(gain, locale, { signed: true })}
      </span>
      {gainRatio !== null && (
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
            directionSurface[direction],
          )}
        >
          {formatRatioAsPercent(gainRatio, locale, { signed: true })}
        </span>
      )}
    </span>
  );
}

export function HoldingsList({
  holdings,
  total,
  locale,
  dictionary,
}: Readonly<{
  holdings: readonly DashboardHolding[];
  /** The portfolio total **in the rows' own currency** — the share column is a ratio of the two. */
  total: Money;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.dashboard.holdings;

  const weight = (holding: DashboardHolding): string => {
    if (holding.valuation === null || total.isZero()) return '—';
    // Two currencies have no ratio, and the one this would print looks entirely
    // ordinary — a dash is the honest answer, not a rate applied on the way
    // past (rule 7). The dashboard passes a matching total; this catches the
    // caller that stops doing so.
    if (holding.valuation.value.currency !== total.currency) return '—';
    return formatRatioAsPercent(
      holding.valuation.value.amount.dividedBy(total.amount).toFixed(6),
      locale,
    );
  };

  const averageCostCell = (holding: DashboardHolding) =>
    holding.averageCost === null ? (
      <Badge variant="outline" className="font-normal">
        {dictionary.portfolio.multipleCurrencies}
      </Badge>
    ) : (
      formatMoney(holding.averageCost, locale)
    );

  const columns: readonly DataListColumn<DashboardHolding>[] = [
    {
      id: 'instrument',
      header: strings.instrument,
      mobile: 'title',
      cell: (holding) => (
        <span className="flex flex-col">
          <span className="font-medium">{holding.symbol}</span>
          <span className="text-muted-foreground truncate text-xs">{holding.name}</span>
        </span>
      ),
    },
    {
      id: 'position',
      header: strings.quantity,
      align: 'end',
      // On a phone the quantity and the average cost share one line, the way a
      // broker app shows them: `420 · 78,30 zł`.
      mobile: 'subtitle',
      cell: (holding) => (
        <>
          <span>{formatQuantity(holding.quantity, locale)}</span>
          <span className="text-muted-foreground md:hidden">
            {' · '}
            {averageCostCell(holding)}
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
      id: 'price',
      header: strings.price,
      align: 'end',
      cell: (holding) =>
        holding.valuation?.price === undefined || holding.valuation?.price === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatMoney(holding.valuation.price, locale)
        ),
    },
    {
      id: 'value',
      header: strings.value,
      align: 'end',
      mobile: 'value',
      // An unvaluable position stays on screen and says so. It is never dropped
      // and never estimated (rule 7).
      cell: (holding) =>
        holding.valuation === null ? (
          <Badge variant="outline" className="font-normal">
            {strings.unvaluable}
          </Badge>
        ) : (
          <span className="font-medium">{formatMoney(holding.valuation.value, locale)}</span>
        ),
    },
    {
      id: 'pnl',
      header: strings.pnl,
      align: 'end',
      mobile: 'meta',
      cell: (holding) => <GainBadge holding={holding} locale={locale} />,
    },
    {
      id: 'weight',
      header: strings.weight,
      align: 'end',
      cell: (holding) => <span className="text-muted-foreground">{weight(holding)}</span>,
    },
  ];

  const unvaluable = holdings.filter((holding) => holding.valuation === null).length;

  return (
    <section className="flex flex-col gap-2">
      <DataList
        rows={holdings}
        columns={columns}
        rowKey={(holding) => holding.id}
        leading={(holding) => <Monogram holding={holding} />}
        empty={strings.empty}
      />

      {unvaluable > 0 && (
        <p className="text-muted-foreground text-xs">
          {interpolate(strings.unvaluableNote, { count: String(unvaluable) })}
        </p>
      )}
    </section>
  );
}
