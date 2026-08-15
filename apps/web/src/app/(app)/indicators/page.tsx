import { Suspense } from 'react';

import { IndicatorCard } from '@/components/indicators/indicator-card';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { readIndicatorSeries } from '@/server/indicators';

/**
 * The two macro series the bond engine reads, shown in their own right — a
 * reference rate and an inflation print are what a Polish investor actually
 * watches, not only an input to a valuation.
 *
 * Each card sits behind its own `<Suspense>` boundary, so a slow GUS does not
 * hold up the NBP number, and neither holds up the page frame. Same shape as
 * `/portfolio`'s streamed price section (ADR 0014).
 */
export default async function IndicatorsPage() {
  const dictionary = await getDictionary();
  const strings = dictionary.indicators;

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
      </div>

      <footer className="text-muted-foreground text-xs">
        {strings.source}: nbp.pl, stat.gov.pl
      </footer>
    </div>
  );
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
