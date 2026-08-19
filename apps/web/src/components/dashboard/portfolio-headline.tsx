import { type DashboardTotals } from '@/lib/dashboard/snapshot';
import { directionOf, directionSurface, formatMoney, formatRatioAsPercent } from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
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
  totals,
  locale,
  dictionary,
}: Readonly<{
  totals: DashboardTotals;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {dictionary.dashboard.totalValue}
      </h2>

      <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
        {formatMoney(totals.totalValue, locale, { bare: true })}
      </span>

      <Change
        label={dictionary.dashboard.totalChange}
        amount={totals.changeTotal}
        ratio={totals.changeTotalRatio}
        locale={locale}
      />

      <p className="text-muted-foreground text-xs">
        {interpolate(dictionary.portfolio.totalValueNote, { currency: totals.totalValue.currency })}
      </p>

      {/* Never render a partial sum as though it were the whole figure (rule 7). */}
      {!totals.totalIsComplete && (
        <p className="text-muted-foreground text-xs">{dictionary.portfolio.totalValueIncomplete}</p>
      )}
    </section>
  );
}
