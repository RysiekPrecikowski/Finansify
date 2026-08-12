import Link from 'next/link';

import { dashboardHref, type DashboardParams } from '@/lib/dashboard-params';
import { assetClasses, type AssetClass } from '@/lib/fixtures/portfolio';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

/**
 * Selection is carried by border and foreground weight, not colour: green and red
 * mean profit and loss here and nothing else (docs/ui.md).
 */
function chipClass(selected: boolean): string {
  return cn(
    'shrink-0 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors',
    selected
      ? 'border-foreground text-foreground font-medium'
      : 'border-border text-muted-foreground hover:text-foreground',
  );
}

export function AssetClassChips({
  params,
  present,
  dictionary,
}: Readonly<{
  params: DashboardParams;
  /** Only classes actually held get a chip — an empty filter is a dead end. */
  present: readonly AssetClass[];
  dictionary: Dictionary;
}>) {
  return (
    <nav
      aria-label={dictionary.dashboard.filterByAssetClass}
      // The chips wrap rather than scroll sideways: a handful of short labels
      // fits in two rows on a phone, and every filter stays visible instead of
      // hiding past the right edge with nothing to say so.
      className="flex flex-wrap gap-2 pb-1"
    >
      <Link
        href={dashboardHref(params, { assetClass: null })}
        aria-current={params.assetClass === null ? 'page' : undefined}
        className={chipClass(params.assetClass === null)}
      >
        {dictionary.dashboard.assetClasses.all}
      </Link>
      {assetClasses
        .filter((assetClass) => present.includes(assetClass))
        .map((assetClass) => (
          <Link
            key={assetClass}
            href={dashboardHref(params, { assetClass })}
            aria-current={params.assetClass === assetClass ? 'page' : undefined}
            className={chipClass(params.assetClass === assetClass)}
          >
            {dictionary.dashboard.assetClasses[assetClass]}
          </Link>
        ))}
    </nav>
  );
}
