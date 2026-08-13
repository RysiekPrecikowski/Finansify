'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type SortOrder } from '@/lib/fixtures/portfolio';
import { dashboardHref } from '@/lib/dashboard-params';
import { useDashboardParams } from '@/lib/use-dashboard-params';

export interface SortOption {
  readonly order: SortOrder;
  readonly label: string;
}

/**
 * The options are real links, so sorting works the same way the rest of the
 * dashboard does. Their hrefs are built here from the live params rather than
 * handed down from the server: a href baked at render time still carries the
 * range the user has since switched away from — see `useDashboardParams`.
 */
export function SortMenu({
  options,
  selected,
  label,
}: Readonly<{ options: readonly SortOption[]; selected: SortOrder; label: string }>) {
  const params = useDashboardParams();
  const current = options.find((option) => option.order === selected);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={label} className="gap-1.5">
            <span className="max-w-[14rem] truncate">{current?.label ?? label}</span>
            <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.order}
            render={<Link href={dashboardHref(params, { sort: option.order })} />}
            data-selected={option.order === selected ? '' : undefined}
            className={option.order === selected ? 'font-medium' : undefined}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
