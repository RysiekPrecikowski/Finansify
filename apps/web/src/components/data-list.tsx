import { type ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * The one responsive table in the app: a real `<table>` at `md` and above, and
 * stacked cards below it (docs/ui.md). Every table goes through this — retrofitting
 * responsiveness onto hand-rolled tables is the miserable path.
 *
 * A column declares where it belongs in the phone layout. Anything without a
 * `mobile` slot simply does not appear on a phone, which is the point: a nine-column
 * ledger row is unreadable at 375 px, so the caller chooses the four values that
 * matter instead of the browser shrinking all nine.
 *
 *     title    ┌──────────────────────────────┐    value
 *     subtitle │ [leading]  title      value  │    meta
 *              │            subtitle   meta   │
 *              └──────────────────────────────┘
 */
export type MobileSlot = 'title' | 'subtitle' | 'value' | 'meta';

export interface DataListColumn<TRow> {
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (row: TRow) => ReactNode;
  /** `end` also means tabular figures — every right-aligned column here is numeric. */
  readonly align?: 'start' | 'end';
  readonly mobile?: MobileSlot;
  readonly headerClassName?: string;
  readonly cellClassName?: string;
}

export interface DataListProps<TRow> {
  readonly rows: readonly TRow[];
  readonly columns: readonly DataListColumn<TRow>[];
  readonly rowKey: (row: TRow) => string;
  /** An icon or avatar shown before the row in both layouts. */
  readonly leading?: (row: TRow) => ReactNode;
  readonly empty?: ReactNode;
  readonly className?: string;
}

function alignmentClass(align: DataListColumn<unknown>['align']): string {
  return align === 'end' ? 'text-right tabular-nums' : 'text-left';
}

function slotOf<TRow>(
  columns: readonly DataListColumn<TRow>[],
  slot: MobileSlot,
): DataListColumn<TRow> | undefined {
  return columns.find((column) => column.mobile === slot);
}

export function DataList<TRow>({
  rows,
  columns,
  rowKey,
  leading,
  empty,
  className,
}: DataListProps<TRow>) {
  if (rows.length === 0 && empty !== undefined) {
    return <p className="text-muted-foreground px-1 py-8 text-sm">{empty}</p>;
  }

  const title = slotOf(columns, 'title');
  const subtitle = slotOf(columns, 'subtitle');
  const value = slotOf(columns, 'value');
  const meta = slotOf(columns, 'meta');

  return (
    <div className={className}>
      {/* Phone: stacked cards. */}
      <ul className="divide-border divide-y md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex items-center gap-3 py-3">
            {leading?.(row)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{title?.cell(row)}</div>
              {subtitle !== undefined && (
                <div className="text-muted-foreground truncate text-xs tabular-nums">
                  {subtitle.cell(row)}
                </div>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium tabular-nums">{value?.cell(row)}</div>
              {meta !== undefined && <div className="text-xs tabular-nums">{meta.cell(row)}</div>}
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet and up: the real thing. */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {leading !== undefined && <TableHead className="w-9" />}
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    'text-muted-foreground text-xs font-medium',
                    alignmentClass(column.align),
                    column.headerClassName,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {leading !== undefined && <TableCell className="w-9">{leading(row)}</TableCell>}
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(alignmentClass(column.align), column.cellClassName)}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
