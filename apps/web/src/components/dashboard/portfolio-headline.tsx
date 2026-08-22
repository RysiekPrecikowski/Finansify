import { Info } from 'lucide-react';
import { type ReactNode } from 'react';

import { type DashboardTotals } from '@/lib/dashboard/snapshot';
import { directionOf, directionSurface, formatMoney, formatRatioAsPercent } from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type Money } from '@finansify/core';
import { cn } from '@/lib/utils';

/** The prominent change row: the amount, then the percentage as a tinted chip. No label — the stat row below names it. */
function Change({
  amount,
  ratio,
  locale,
}: Readonly<{ amount: Money; ratio: string; locale: Locale }>) {
  const direction = directionOf(amount);

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'text-sm font-medium tabular-nums',
          direction === 'up'
            ? 'text-gain'
            : direction === 'down'
              ? 'text-loss'
              : 'text-muted-foreground',
        )}
      >
        {formatMoney(amount, locale, { signed: true })}
      </span>
      <span
        className={cn(
          'rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
          directionSurface[direction],
        )}
      >
        {formatRatioAsPercent(ratio, locale, { signed: true })}
      </span>
    </div>
  );
}

/** One column of the summary strip under the change row: a small uppercase label over a figure. */
function Stat({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground truncate text-[0.6875rem] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="truncate text-sm font-medium tabular-nums">{children}</span>
    </div>
  );
}

export function PortfolioHeadline({
  totals,
  asOf,
  locale,
  dictionary,
}: Readonly<{
  totals: DashboardTotals;
  /**
   * When the prices behind this total were last fetched, already formatted.
   * `null` when nothing here was priced from a quote (an all-bond portfolio, or
   * a first render before any refresh has landed) — the line is omitted rather
   * than showing a time that describes nothing.
   */
  asOf: string | null;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {dictionary.dashboard.totalValue}
        </h2>
        {asOf !== null && (
          <span className="text-muted-foreground/70 text-[0.6875rem] tabular-nums">
            {dictionary.dashboard.asOf} {asOf}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {formatMoney(totals.totalValue, locale, { bare: true })}
        </span>
        {/* The scope note used to sit under the change as a full sentence,
            which is a paragraph of caveat above the fold on a phone. It is
            still here — what a total does and does not include is not
            droppable — just folded into the value it qualifies. */}
        <span
          className="text-muted-foreground/60"
          title={interpolate(dictionary.portfolio.totalValueNote, {
            currency: totals.totalValue.currency,
          })}
        >
          <Info className="size-4" aria-hidden />
          <span className="sr-only">
            {interpolate(dictionary.portfolio.totalValueNote, {
              currency: totals.totalValue.currency,
            })}
          </span>
        </span>
      </div>

      <Change amount={totals.changeTotal} ratio={totals.changeTotalRatio} locale={locale} />

      <div className="mt-1 grid grid-cols-2 gap-3">
        <Stat label={dictionary.dashboard.totalChange}>
          {formatMoney(totals.changeTotal, locale, { signed: true })}
          <span className="text-muted-foreground"> · </span>
          {formatRatioAsPercent(totals.changeTotalRatio, locale, { signed: true })}
        </Stat>
        {/* Cost basis, summed and converted the same way the market value was
            (`buildTotals`) — the figure the value above is a change *from*. */}
        <Stat label={dictionary.dashboard.invested}>{formatMoney(totals.totalCost, locale)}</Stat>
      </div>

      {/* Never render a partial sum as though it were the whole figure (rule 7).
          Stays in the flow rather than moving into the icon above: this one is
          a warning about the number itself, not a note about its scope. */}
      {!totals.totalIsComplete && (
        <p className="text-muted-foreground text-xs">{dictionary.portfolio.totalValueIncomplete}</p>
      )}
    </section>
  );
}
