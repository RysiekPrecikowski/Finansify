import { type IndexId } from '@finansify/core';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { formatFxRate, formatPlainDate, formatRatioAsPercent } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { readAllIndicators } from '@/server/indicators';
import { readFxPairSeries, type FxPairSeries } from '@/server/fx-series';

/**
 * "Kursy i wskaźniki": three FX pairs against PLN plus the two macro series
 * `/indicators` already reads — all real, already-wired data
 * (`server/indicators.ts`, `server/fx-series.ts`), just the latest reading of
 * each rather than the full chart. Deliberately reads NBP's own series rather
 * than the reader's FX display preference: the same reasoning
 * `CurrencySwitcher` states for the portfolio total applies here — this card
 * is a reference snapshot, not the rate anything on the page is valued at.
 *
 * This replaces the old `IndicatorStrip` link-through row that used to sit
 * above the fold: same destination (`/indicators`), same two macro readings,
 * now folded into one section instead of two showing overlapping numbers.
 * `indicator-strip.tsx` is deleted — it had no other caller.
 *
 * Its own `<Suspense>` boundary in `DashboardSections` — a slow FX or GUS
 * upstream should only ever delay this one card, never account tiles or
 * holdings.
 */

const fxPairs = [
  { base: 'USD', quote: 'PLN' },
  { base: 'EUR', quote: 'PLN' },
  { base: 'CHF', quote: 'PLN' },
] as const;

function SnapshotCard({
  label,
  value,
  asOf,
}: Readonly<{ label: string; value: string; asOf: string | null }>) {
  return (
    <div className="bg-card flex flex-col gap-1 rounded-xl px-3.5 py-3">
      <span className="text-muted-foreground text-[0.6875rem] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {asOf !== null && (
        <span className="text-muted-foreground/70 text-[0.6875rem] tabular-nums">{asOf}</span>
      )}
    </div>
  );
}

export async function MarketSnapshot({
  locale,
  dictionary,
}: Readonly<{ locale: Locale; dictionary: Dictionary }>) {
  const [usd, eur, chf, indicators] = await Promise.all([
    readFxPairSeries(fxPairs[0], '1M'),
    readFxPairSeries(fxPairs[1], '1M'),
    readFxPairSeries(fxPairs[2], '1M'),
    readAllIndicators(),
  ]);

  const strings = dictionary.dashboard.marketSnapshot;

  const fxCard = (pair: (typeof fxPairs)[number], series: FxPairSeries) => {
    const summary = series.summary;
    return (
      <SnapshotCard
        label={`${pair.base}/${pair.quote}`}
        value={summary === null ? '—' : formatFxRate(summary.latest.rate.toFixed(6), locale)}
        asOf={summary === null ? null : formatPlainDate(summary.latest.date, locale)}
      />
    );
  };

  const indicatorLabels: Record<IndexId, string> = {
    nbp_reference: strings.referenceRate,
    pl_cpi_yoy: strings.cpi,
  };

  const indicatorCard = (indexId: IndexId) => {
    const series = indicators.find((entry) => entry.summary?.indexId === indexId);
    const summary = series?.summary ?? null;
    return (
      <SnapshotCard
        label={indicatorLabels[indexId]}
        value={
          summary === null ? '—' : formatRatioAsPercent(summary.latest.value.toFixed(6), locale)
        }
        asOf={summary === null ? null : formatPlainDate(summary.latest.effectiveFrom, locale)}
      />
    );
  };

  const fxSeries = [usd, eur, chf];

  return (
    <section className="flex flex-col gap-3">
      <Link
        href="/indicators"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
      >
        {strings.title}
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      </Link>

      {/* One 6-track grid rather than two independently-sized ones: row 1's
          three cards each span 2 tracks, row 2's two cards each span 3 —
          same total width and gap, so row 2 lands centered under row 1
          without any manual offset math ("brick" layout from the brief). */}
      <div className="grid grid-cols-6 gap-3">
        {fxPairs.map((pair, index) => (
          <div key={`${pair.base}${pair.quote}`} className="col-span-2">
            {fxCard(pair, fxSeries[index]!)}
          </div>
        ))}
        <div className="col-span-3">{indicatorCard('nbp_reference')}</div>
        <div className="col-span-3">{indicatorCard('pl_cpi_yoy')}</div>
      </div>
    </section>
  );
}
