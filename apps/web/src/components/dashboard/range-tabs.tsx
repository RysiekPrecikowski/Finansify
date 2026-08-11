import Link from 'next/link';

import { dashboardHref, type DashboardParams } from '@/lib/dashboard-params';
import { ranges } from '@/lib/fixtures/portfolio';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

export function RangeTabs({
  params,
  dictionary,
}: Readonly<{ params: DashboardParams; dictionary: Dictionary }>) {
  return (
    <nav aria-label={dictionary.dashboard.chartRange} className="flex justify-between gap-1">
      {ranges.map((range) => {
        const selected = params.range === range;
        return (
          <Link
            key={range}
            href={dashboardHref(params, { range })}
            aria-current={selected ? 'page' : undefined}
            // 44 px of height on a phone: charts and their controls are touch-first.
            className={cn(
              'flex h-9 flex-1 items-center justify-center rounded-full px-3 text-xs font-medium transition-colors',
              selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {dictionary.dashboard.ranges[range]}
          </Link>
        );
      })}
    </nav>
  );
}
