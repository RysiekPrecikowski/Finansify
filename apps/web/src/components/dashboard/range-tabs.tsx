'use client';

import Link from 'next/link';
import { type MouseEvent } from 'react';

import { dashboardHref, ranges, type Range } from '@/lib/dashboard-params';
import { useDashboardParams } from '@/lib/use-dashboard-params';
import { cn } from '@/lib/utils';

export interface RangeTabsProps {
  readonly labels: Readonly<Record<Range, string>>;
  readonly navLabel: string;
  readonly selected: Range;
  readonly onSelect: (range: Range) => void;
}

/**
 * A modified click still belongs to the browser — cmd-click and middle-click
 * open the range in a new tab, and without JavaScript the href navigates as it
 * always did. Only the plain left click is taken over, which is the one the
 * client can answer instantly.
 */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function RangeTabs({ labels, navLabel, selected, onSelect }: RangeTabsProps) {
  // Derived here rather than handed down, so the class and sort a link carries
  // are the ones in the URL right now — see `useDashboardParams`.
  const params = useDashboardParams();

  return (
    <nav aria-label={navLabel} className="flex justify-between gap-1">
      {ranges.map((range) => (
        <Link
          key={range}
          href={dashboardHref(params, { range })}
          aria-current={selected === range ? 'page' : undefined}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onSelect(range);
          }}
          // 44 px of height on a phone: charts and their controls are touch-first.
          className={cn(
            'flex h-9 flex-1 items-center justify-center rounded-full px-3 text-xs font-medium transition-colors',
            selected === range
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labels[range]}
        </Link>
      ))}
    </nav>
  );
}
