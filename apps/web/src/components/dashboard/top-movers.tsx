import { getTopMovers } from '@/lib/dashboard/demo-enrichment';
import { type DashboardHolding } from '@/lib/dashboard/snapshot';
import { directionSurface, formatRatioAsPercent } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * The day's biggest movers among the reader's own holdings. The daily move
 * itself is demo data (`lib/dashboard/demo-enrichment.ts`) — there is no
 * intraday feed yet — everything else (symbol, name) is real.
 */
export function TopMovers({
  holdings,
  locale,
  dictionary,
}: Readonly<{
  holdings: readonly DashboardHolding[];
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.dashboard.topMovers;
  const movers = getTopMovers(holdings, 5);

  if (movers.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {strings.title}
      </h2>

      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {movers.map(({ holding, dayChangeRatio }) => (
          <MoverCard
            key={holding.id}
            holding={holding}
            dayChangeRatio={dayChangeRatio}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}

function MoverCard({
  holding,
  dayChangeRatio,
  locale,
}: Readonly<{ holding: DashboardHolding; dayChangeRatio: string; locale: Locale }>) {
  const direction =
    Number(dayChangeRatio) > 0 ? 'up' : Number(dayChangeRatio) < 0 ? 'down' : 'flat';

  return (
    <div className="bg-card flex w-32 shrink-0 flex-col gap-2 rounded-2xl px-3.5 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{holding.symbol}</span>
        <span className="text-muted-foreground truncate text-xs">{holding.name}</span>
      </div>
      <span
        className={cn(
          'w-fit rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
          directionSurface[direction],
        )}
      >
        {formatRatioAsPercent(dayChangeRatio, locale, { signed: true })}
      </span>
    </div>
  );
}
