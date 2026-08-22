'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { benchmarks, type Benchmark } from '@/lib/dashboard/benchmarks';
import { dashboardHref } from '@/lib/dashboard-params';
import { useDashboardParams } from '@/lib/use-dashboard-params';

export interface BenchmarkSelectProps {
  readonly selected: Benchmark;
  readonly names: Readonly<Record<Benchmark, string>>;
  /** The word before the ticker — "Indeks" / "Index". */
  readonly label: string;
  readonly ariaLabel: string;
  /** Footer note in the menu: the series is illustrative until a real index feed exists. */
  readonly note: string;
  readonly onSelect: (benchmark: Benchmark) => void;
}

/**
 * The chart card's right-hand control: `INDEKS WIG20TR ⌄`.
 *
 * Shaped like `SortMenu` — real links, hrefs built from the live params — but
 * it also takes the plain left click on the client the way `RangeTabs` does,
 * because the benchmark series is derived in the browser
 * (`lib/dashboard/benchmarks.ts`) and a server round trip would fetch nothing.
 * Modified clicks and a JavaScript-off render still navigate.
 */
export function BenchmarkSelect({
  selected,
  names,
  label,
  ariaLabel,
  note,
  onSelect,
}: BenchmarkSelectProps) {
  const params = useDashboardParams();

  /**
   * Typed on the DOM event rather than on React's `MouseEvent<HTMLAnchorElement>`:
   * the menu item forwards its own handler type (a `<div>`-shaped Base UI
   * event) to whatever it renders, so the anchor's element type is not what
   * arrives here. Only the modifier keys are read, which every mouse event has.
   */
  function isPlainClick(event: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }): boolean {
    return (
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[0.6875rem] font-medium tracking-wide uppercase transition-colors"
          >
            {label}
            <span className="text-foreground">{names[selected]}</span>
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="end">
        {benchmarks.map((benchmark) => (
          <DropdownMenuItem
            key={benchmark}
            render={<Link href={dashboardHref(params, { benchmark })} />}
            className={benchmark === selected ? 'font-medium' : undefined}
            onClick={(event) => {
              if (!isPlainClick(event)) return;
              event.preventDefault();
              onSelect(benchmark);
            }}
          >
            {names[benchmark]}
          </DropdownMenuItem>
        ))}
        <p className="text-muted-foreground max-w-56 px-2 py-1.5 text-xs">{note}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
