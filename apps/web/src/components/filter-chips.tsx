import Link from 'next/link';
import { type Route } from 'next';
import { type ReactNode } from 'react';

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

/**
 * The row container every chip row in the app uses.
 *
 * **Wrapping is the overflow behaviour, and it is the whole reason this is
 * shared.** A naive horizontal strip clips the last chip at the right edge with
 * nothing to say more exists — which is exactly how `/allocation`'s dimension
 * and model rows shipped in the canvas, and the same failure the dashboard's
 * rate cards had to be rebuilt to avoid. Wrapping keeps every option visible at
 * 390 px with no scroll affordance to discover. Any new chip row goes through
 * `<FilterChips>` or `<SelectChips>` rather than re-deciding this per screen.
 */
function ChipRow({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </nav>
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
    <ChipRow label={label}>
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
    </ChipRow>
  );
}

export interface SelectChip<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

/**
 * The same row and the same chip, driven by client state instead of the URL.
 *
 * `/allocation`'s three selectors (dimension, model, contribution amount) all
 * recompute derived figures in the browser with nothing to fetch, so a
 * navigation per press would be latency for its own sake — unlike the
 * dashboard's and `/portfolio`'s filters, which are server renders. What must
 * not differ between them is how a row too wide for the screen behaves, which
 * is why both variants share `ChipRow` rather than each choosing.
 *
 * Rendered only from client components; the file itself stays server-safe so
 * `<FilterChips>` can keep being used from server pages.
 */
export function SelectChips<TValue extends string>({
  label,
  options,
  selected,
  onSelect,
  disabled = false,
}: Readonly<{
  label: string;
  options: readonly SelectChip<TValue>[];
  selected: TValue;
  onSelect: (value: TValue) => void;
  /** Dims the row and blocks presses — the contribution amounts before the mode is switched on. */
  disabled?: boolean;
}>) {
  return (
    <ChipRow label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={option.value === selected}
          onClick={() => onSelect(option.value)}
          className={cn(
            chipClass(option.value === selected),
            disabled && 'pointer-events-none opacity-45',
          )}
        >
          {option.label}
        </button>
      ))}
    </ChipRow>
  );
}
