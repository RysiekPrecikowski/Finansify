import { type IndexId } from '@finansify/core';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { formatPlainDate, formatRatioAsPercent } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type IndicatorSeries } from '@/server/indicators';

import { IndicatorChart } from './indicator-chart';

/**
 * Copy that belongs to a series rather than to the page, resolved here so the
 * page does not carry a switch on `indexId`.
 *
 * The publisher matters and is easy to get wrong: **inflation is announced by
 * the President of Statistics Poland, not by the NBP.** The NBP side is the
 * reference rate, which the Monetary Policy Council sets. Labelling each series
 * with its actual publisher is also the attribution both sources ask for.
 */
function stringsFor(indexId: IndexId, dictionary: Dictionary) {
  const strings = dictionary.indicators;
  return indexId === 'nbp_reference'
    ? {
        title: strings.referenceRate,
        publisher: strings.referenceRateBy,
        note: strings.referenceRateNote,
        dateLabel: strings.effectiveFrom,
      }
    : {
        title: strings.cpi,
        publisher: strings.cpiBy,
        note: strings.cpiNote,
        dateLabel: strings.announcedIn,
      };
}

export function IndicatorCard({
  indexId,
  series,
  locale,
  dictionary,
}: Readonly<{
  indexId: IndexId;
  series: IndicatorSeries;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.indicators;
  const copy = stringsFor(indexId, dictionary);
  const { summary } = series;

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{copy.title}</h2>
        <p className="text-muted-foreground text-xs">{copy.publisher}</p>
      </header>

      {summary === null ? (
        <p className="text-muted-foreground text-sm">{strings.unavailable}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {formatRatioAsPercent(summary.latest.value.toFixed(6), locale)}
            </span>
            <ChangeBadge series={series} locale={locale} dictionary={dictionary} />
          </div>

          {/* Stale or fresh, the number always carries the date it belongs to —
              apps/web/AGENTS.md: never render an old figure as though it were live. */}
          <p className="text-muted-foreground text-xs">
            {copy.dateLabel} {formatPlainDate(summary.latest.effectiveFrom, locale)}
          </p>

          <IndicatorChart history={series.history} locale={locale} label={copy.title} />
        </>
      )}

      <p className="text-muted-foreground text-xs">{copy.note}</p>

      {series.error !== null && (
        <p className="text-muted-foreground border-t pt-2 text-xs">{strings.refreshFailed}</p>
      )}
    </section>
  );
}

/**
 * The move since the previous reading.
 *
 * Deliberately **not** green/red: `docs/ui.md` reserves those for profit and
 * loss, and a falling reference rate is neither good nor bad on its own — it is
 * good for a borrower and bad for a saver. Direction is carried by an arrow and
 * a sign instead.
 */
function ChangeBadge({
  series,
  locale,
  dictionary,
}: Readonly<{ series: IndicatorSeries; locale: Locale; dictionary: Dictionary }>) {
  const change = series.summary?.change ?? null;
  if (change === null) return null;

  const Icon = change.isZero() ? Minus : change.isNegative() ? TrendingDown : TrendingUp;

  return (
    <span className="text-muted-foreground flex items-center gap-1 text-xs">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">
        {change.isZero()
          ? dictionary.indicators.noChange
          : formatRatioAsPercent(change.toFixed(6), locale, { signed: true })}
      </span>
    </span>
  );
}
