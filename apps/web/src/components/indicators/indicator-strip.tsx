import { type IndexId } from '@finansify/core';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { formatPlainDate, formatRatioAsPercent } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { readAllIndicators } from '@/server/indicators';

/**
 * The compact form, for the dashboard: both current readings on one line, with
 * their dates, linking through to the full view.
 *
 * Reads the same server function the full page does, so the two can never
 * disagree about what the current rate is.
 */
export async function IndicatorStrip({
  locale,
  dictionary,
}: Readonly<{ locale: Locale; dictionary: Dictionary }>) {
  const series = await readAllIndicators();
  const strings = dictionary.indicators;

  const labels: Record<IndexId, string> = {
    nbp_reference: strings.referenceRate,
    pl_cpi_yoy: strings.cpi,
  };

  const readings = series.filter((entry) => entry.summary !== null);
  // Nothing fetched yet is not worth a row of empty state on the dashboard —
  // the full view explains it properly.
  if (readings.length === 0) return null;

  return (
    <Link
      href="/indicators"
      className="hover:bg-muted/50 flex items-center gap-4 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-1 flex-wrap items-baseline gap-x-6 gap-y-1">
        {readings.map((entry) => {
          const summary = entry.summary;
          if (summary === null) return null;
          return (
            <span key={summary.indexId} className="flex items-baseline gap-2">
              <span className="text-muted-foreground text-xs">{labels[summary.indexId]}</span>
              <span className="text-sm font-medium tabular-nums">
                {formatRatioAsPercent(summary.latest.value.toFixed(6), locale)}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatPlainDate(summary.latest.effectiveFrom, locale)}
              </span>
            </span>
          );
        })}
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}
