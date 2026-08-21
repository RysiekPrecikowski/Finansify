import { type Money } from '@finansify/core';

import { getSectorBreakdown, type DemoSectorKey } from '@/lib/dashboard/demo-enrichment';
import { type DashboardHolding } from '@/lib/dashboard/snapshot';
import { formatRatioAsPercent } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';

/** Neutral ramp, largest slice darkest — `--chart-1..5` (`globals.css`), never a per-sector hue. */
const ramp = [
  'var(--chart-5)',
  'var(--chart-4)',
  'var(--chart-3)',
  'var(--chart-2)',
  'var(--chart-1)',
];

/**
 * Sector is demo data (`lib/dashboard/demo-enrichment.ts`) — `core` has no
 * sector taxonomy yet — laid over the real, priced holding values.
 */
export function SectorBreakdown({
  holdings,
  total,
  locale,
  dictionary,
}: Readonly<{
  holdings: readonly DashboardHolding[];
  total: Money;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.dashboard.sectors;
  const slices = getSectorBreakdown(holdings, total);

  if (slices.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {strings.title}
      </h2>

      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
        {slices.map((slice, index) => (
          <div
            key={slice.sector}
            style={{
              width: `${Math.max(Number(slice.ratio) * 100, 1.5)}%`,
              backgroundColor: ramp[index % ramp.length],
            }}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {slices.map((slice, index) => (
          <li key={slice.sector} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: ramp[index % ramp.length] }}
            />
            <span className="flex-1 truncate">{sectorLabel(slice.sector, strings)}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatRatioAsPercent(slice.ratio, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sectorLabel(sector: DemoSectorKey, strings: Dictionary['dashboard']['sectors']): string {
  return strings.labels[sector];
}
