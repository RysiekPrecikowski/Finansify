import { Suspense } from 'react';

import { FxPairCard } from '@/components/indicators/fx-pair-card';
import { IndicatorCard } from '@/components/indicators/indicator-card';
import { fxParamsFrom, type FxParams } from '@/lib/fx-pairs';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { readFxPairSeries } from '@/server/fx-series';
import { readIndicatorSeries } from '@/server/indicators';

/**
 * The macro series a Polish investor actually watches: the reference rate and
 * an inflation print — which the bond engine also reads — plus a currency pair,
 * which nothing in the domain reads but everyone holding a foreign instrument
 * looks at anyway.
 *
 * Each card sits behind its own `<Suspense>` boundary, so a slow GUS does not
 * hold up the NBP number, and neither holds up the page frame. Same shape as
 * `/portfolio`'s streamed price section (ADR 0014).
 */
export default async function IndicatorsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const [dictionary, raw] = await Promise.all([getDictionary(), searchParams]);
  const strings = dictionary.indicators;
  const params = fxParamsFrom(raw);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{strings.title}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{strings.subtitle}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<IndicatorCardFallback />}>
          <LiveIndicator indexId="nbp_reference" />
        </Suspense>
        <Suspense fallback={<IndicatorCardFallback />}>
          <LiveIndicator indexId="pl_cpi_yoy" />
        </Suspense>
        {/* Keyed by the params so switching pair or range re-suspends this card
            alone, rather than showing the previous pair's number under the new
            pair's heading while the fetch is in flight. */}
        <Suspense key={`${params.pair}:${params.range}`} fallback={<IndicatorCardFallback />}>
          <LiveFxPair params={params} />
        </Suspense>
      </div>

      <footer className="text-muted-foreground text-xs">
        {strings.source}: nbp.pl, stat.gov.pl
      </footer>
    </div>
  );
}

async function LiveFxPair({ params }: Readonly<{ params: FxParams }>) {
  const [series, dictionary, locale] = await Promise.all([
    readFxPairSeries(params.pair, params.range),
    getDictionary(),
    getLocale(),
  ]);

  return <FxPairCard params={params} series={series} locale={locale} dictionary={dictionary} />;
}

async function LiveIndicator({ indexId }: Readonly<{ indexId: 'nbp_reference' | 'pl_cpi_yoy' }>) {
  const [series, dictionary, locale] = await Promise.all([
    readIndicatorSeries(indexId),
    getDictionary(),
    getLocale(),
  ]);

  return (
    <IndicatorCard indexId={indexId} series={series} locale={locale} dictionary={dictionary} />
  );
}

function IndicatorCardFallback() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="bg-muted h-4 w-40 animate-pulse rounded" />
      <div className="bg-muted h-8 w-24 animate-pulse rounded" />
      <div className="bg-muted h-12 w-full animate-pulse rounded" />
    </div>
  );
}
