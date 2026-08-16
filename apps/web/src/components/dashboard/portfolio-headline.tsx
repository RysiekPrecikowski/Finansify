import { ArrowLeftRight } from 'lucide-react';

import {
  directionOf,
  directionSurface,
  formatInstant,
  formatMoney,
  formatRatioAsPercent,
} from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type PortfolioSnapshot } from '@/lib/fixtures/portfolio';
import { type Money } from '@finansify/core';
import { cn } from '@/lib/utils';

function Change({
  label,
  amount,
  ratio,
  locale,
}: Readonly<{ label: string; amount: Money; ratio: string; locale: Locale }>) {
  const direction = directionOf(amount);

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
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

export function PortfolioHeadline({
  snapshot,
  locale,
  dictionary,
  display,
}: Readonly<{
  snapshot: PortfolioSnapshot;
  locale: Locale;
  dictionary: Dictionary;
  /** The currency the reader picked in the header, which this page cannot honour yet. */
  display: string;
}>) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {dictionary.dashboard.totalValue}
      </h2>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {formatMoney(snapshot.totalValue, locale, { bare: true })}
        </span>
        {/* States the currency these figures are actually in, which is the
            fixture's, not the reader's choice — this page has no ledger behind
            it yet. The header switcher is global, so a reader who picked EUR
            and saw PLN here would reasonably call it broken; the line below
            says why instead of leaving it to a `title` nobody hovers. */}
        <span
          title={dictionary.dashboard.currencyLocked}
          className="text-muted-foreground inline-flex cursor-help items-center gap-1 text-sm font-medium"
        >
          {snapshot.totalValue.currency}
          <ArrowLeftRight className="size-3.5" />
        </span>
      </div>

      {display !== snapshot.totalValue.currency && (
        <p className="text-muted-foreground text-xs">
          {interpolate(dictionary.dashboard.currencyIgnored, { currency: display })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Change
          label={dictionary.dashboard.todayChange}
          amount={snapshot.changeToday}
          ratio={snapshot.changeTodayRatio}
          locale={locale}
        />
        <Change
          label={dictionary.dashboard.totalChange}
          amount={snapshot.changeTotal}
          ratio={snapshot.changeTotalRatio}
          locale={locale}
        />
      </div>

      {/* Never render an old number as though it were live (docs/ui.md). */}
      <p className="text-muted-foreground text-xs">
        {dictionary.dashboard.asOf} {formatInstant(snapshot.asOf, locale)}
      </p>
    </section>
  );
}
