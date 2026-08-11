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
import { type DashboardHref } from '@/lib/dashboard-params';

export interface SortOption {
  readonly order: SortOrder;
  readonly label: string;
  readonly href: DashboardHref;
}

/**
 * Client only for the popup; the options themselves are links built on the
 * server, so sorting works the same way the rest of the dashboard does.
 */
export function SortMenu({
  options,
  selected,
  label,
}: Readonly<{ options: readonly SortOption[]; selected: SortOrder; label: string }>) {
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
            render={<Link href={option.href} />}
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
