'use client';

import { FilterChips, type FilterChip } from '@/components/filter-chips';
import { dashboardHref } from '@/lib/dashboard-params';
import { useDashboardParams } from '@/lib/use-dashboard-params';
import { assetClasses, type AssetClass } from '@/lib/dashboard/snapshot';
import { type Dictionary } from '@/lib/i18n/dictionaries';

/**
 * The dashboard's asset-class filter. The chip look itself lives in
 * `components/filter-chips.tsx`, shared with `/portfolio` — this component is
 * only the dashboard's data and its href contract.
 */
export function AssetClassChips({
  present,
  dictionary,
}: Readonly<{
  /** Only classes actually held get a chip — an empty filter is a dead end. */
  present: readonly AssetClass[];
  dictionary: Dictionary;
}>) {
  // Live, not a server snapshot: these links must keep whatever range the user
  // switched to on the client — see `useDashboardParams`.
  const params = useDashboardParams();

  const chips: readonly FilterChip<AssetClass>[] = [
    {
      value: null,
      label: dictionary.dashboard.assetClasses.all,
      href: dashboardHref(params, { assetClass: null }),
    },
    ...assetClasses
      .filter((assetClass) => present.includes(assetClass))
      .map((assetClass) => ({
        value: assetClass,
        label: dictionary.dashboard.assetClasses[assetClass],
        href: dashboardHref(params, { assetClass }),
      })),
  ];

  return (
    <FilterChips
      label={dictionary.dashboard.filterByAssetClass}
      chips={chips}
      selected={params.assetClass}
    />
  );
}
