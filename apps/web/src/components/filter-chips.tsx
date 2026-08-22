import Link from 'next/link';
import { type Route } from 'next';

import { cn } from '@/lib/utils';

/**
 * The one filter-chip look in the app.
 *
 * Selection is carried by border and foreground weight, not colour: green and
 * red mean profit and loss here and nothing else (docs/ui.md). Extracted from
 * `components/dashboard/asset-class-chips.tsx` when `/portfolio` grew filters
 * of its own — a second hand-written copy of these classes is how the two
 * screens start drifting apart (rule 13).
 */
export function chipClass(selected: boolean): string {
  return cn(
    'shrink-0 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors',
    selected
      ? 'border-foreground text-foreground font-medium'
      : 'border-border text-muted-foreground hover:text-foreground',
  );
}

export interface FilterChip<TValue> {
  /** `null` is the "all" chip — every list has exactly one, first. */
  readonly value: TValue | null;
  readonly label: string;
  readonly href: Route | { pathname: string; query: Record<string, string> };
}

/**
 * A row of filter chips as real links, so the filter is a server render and
 * survives a reload and a share — the same URL-parameter contract
 * `docs/ui.md` states for the dashboard's chips and sort order.
 *
 * The chips wrap rather than scroll sideways: a handful of short labels fits in
 * two rows on a phone, and every filter stays visible instead of hiding past
 * the right edge with nothing to say so.
 */
export function FilterChips<TValue extends string>({
  label,
  chips,
  selected,
}: Readonly<{
  label: string;
  chips: readonly FilterChip<TValue>[];
  selected: TValue | null;
}>) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.value ?? '__all__'}
          href={chip.href as Route}
          aria-current={chip.value === selected ? 'page' : undefined}
          className={chipClass(chip.value === selected)}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  );
}
