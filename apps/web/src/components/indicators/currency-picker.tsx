'use client';

import type { Route } from 'next';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { commonFxCurrencies, type FxCurrency } from '@/lib/fx-pairs';

/**
 * One leg of the pair, over all 33 table-A currencies.
 *
 * A dropdown rather than the row of chips this replaced: five fitted, thirty-
 * three do not, and a wrapping chip row would push the chart off a phone
 * screen. The five anyone here actually holds stay at the top, above a
 * separator, so the common case is still one click and no scrolling.
 *
 * Options arrive as finished `{ code, href }` — plain data, not a callback.
 * A function prop cannot cross the server/client boundary at all: React refuses
 * to serialize it, and the page 500s with "Functions cannot be passed directly
 * to Client Components". The parent knows both legs, so it builds the URLs.
 */
export interface CurrencyOption {
  readonly code: FxCurrency;
  /** Where picking it goes. Built on the server — see the note above. */
  readonly href: string;
  /** True for the currency that is currently the *other* leg: picking it swaps the pair. */
  readonly swaps: boolean;
}

export function CurrencyPicker({
  value,
  options,
  label,
}: Readonly<{
  value: FxCurrency;
  options: readonly CurrencyOption[];
  label: string;
}>) {
  const router = useRouter();

  const item = (option: CurrencyOption) => (
    <DropdownMenuItem
      key={option.code}
      disabled={option.code === value}
      onClick={() => {
        // Not a typedRoutes literal: the query is assembled from the other leg,
        // which `RouteImpl` cannot express.
        router.push(option.href as Route);
      }}
    >
      {option.code}
      {option.swaps && <span className="text-muted-foreground ml-auto text-xs">⇄</span>}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={label} className="gap-1 tabular-nums">
            {value}
            <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      {/* 33 entries need a scroll box; without the cap the menu runs off the
          viewport on a phone and the last currencies are unreachable. */}
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.filter((option) => commonFxCurrencies.includes(option.code)).map(item)}
        <DropdownMenuSeparator />
        {options.filter((option) => !commonFxCurrencies.includes(option.code)).map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
