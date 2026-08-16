import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { formatFxRate, formatPlainDate } from '@/lib/format';
import { fxHref, fxPairLabel, fxPairs, fxRanges, type FxParams } from '@/lib/fx-pairs';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type FxPairSeries } from '@/server/fx-series';

import { Sparkline } from './indicator-sparkline';

/**
 * One currency pair, its history over the chosen window, and the two pickers
 * that choose them.
 *
 * Both pickers are plain links (`lib/fx-pairs.ts`): the series is fetched and
 * charted on the server, so there is nothing on the client to switch between,
 * and a link survives a reload and a share. No client-side range state here,
 * unlike the dashboard chart — that one holds every series in the browser
 * already, this one would have to fetch.
 */
export function FxPairCard({
  params,
  series,
  locale,
  dictionary,
}: Readonly<{
  params: FxParams;
  series: FxPairSeries;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.indicators;
  const { summary } = series;

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{fxPairLabel(params.pair)}</h2>
        <p className="text-muted-foreground text-xs">{strings.fxBy}</p>
      </header>

      <nav className="flex flex-wrap gap-1" aria-label={strings.fxPair}>
        {fxPairs.map((candidate) => (
          <PickerLink
            key={candidate}
            href={fxHref(params, { pair: candidate })}
            active={candidate === params.pair}
          >
            {fxPairLabel(candidate)}
          </PickerLink>
        ))}
      </nav>

      {summary === null ? (
        <p className="text-muted-foreground text-sm">{strings.unavailable}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {formatFxRate(summary.latest.rate.toFixed(6), locale)}
            </span>
            <ChangeBadge series={series} locale={locale} dictionary={dictionary} />
          </div>

          {/* The rate always carries the day it was fixed on — apps/web/AGENTS.md:
              never render an old figure as though it were live. */}
          <p className="text-muted-foreground text-xs">
            {strings.fixedOn} {formatPlainDate(summary.latest.date, locale)}
          </p>

          <Sparkline
            points={series.history.map((point) => ({ value: Number(point.rate.toFixed(6)) }))}
            shape="line"
          />
        </>
      )}

      <nav className="flex flex-wrap gap-1" aria-label={strings.fxRange}>
        {fxRanges.map((candidate) => (
          <PickerLink
            key={candidate}
            href={fxHref(params, { range: candidate })}
            active={candidate === params.range}
          >
            {candidate}
          </PickerLink>
        ))}
      </nav>

      <p className="text-muted-foreground text-xs">{strings.fxNote}</p>

      {series.error !== null && (
        <p className="text-muted-foreground border-t pt-2 text-xs">{strings.refreshFailed}</p>
      )}
    </section>
  );
}

function PickerLink({
  href,
  active,
  children,
}: Readonly<{
  href: ReturnType<typeof fxHref>;
  active: boolean;
  children: React.ReactNode;
}>) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors',
        active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * The move since the previous fixing, and across the whole window.
 *
 * Deliberately **not** green/red: `docs/ui.md` reserves those for profit and
 * loss, and a stronger złoty is neither on its own — good if you are buying
 * dollars, bad if you are holding them. Direction is an arrow and a sign.
 */
function ChangeBadge({
  series,
  locale,
  dictionary,
}: Readonly<{ series: FxPairSeries; locale: Locale; dictionary: Dictionary }>) {
  const change = series.summary?.changeOverWindow ?? null;
  if (change === null) return null;

  const Icon = change.isZero() ? Minus : change.isNegative() ? TrendingDown : TrendingUp;

  return (
    <span className="text-muted-foreground flex items-center gap-1 text-xs">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">
        {change.isZero()
          ? dictionary.indicators.noChange
          : formatFxRate(change.toFixed(6), locale, { signed: true })}
      </span>
    </span>
  );
}
