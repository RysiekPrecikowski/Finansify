import { importBatchIdSchema, Money, type ImportRow, type ImportRowStatus } from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { interpolate } from '@/lib/i18n/dictionaries';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { formatMoney, formatPlainDate } from '@/lib/format';
import { scopedImportsFor } from '@/server/container';
import { acceptRowAction } from '../../actions';

function grossValueOfParsedRow(row: ImportRow['parsed']): Money {
  if (row.grossAmount !== null) return row.grossAmount;
  if (row.price !== null) return row.price.times(row.quantity);
  return Money.zero(row.currency);
}

function descriptionOf(row: ImportRow): string {
  if (row.parsed.instrument !== null) {
    const { symbol, exchange } = row.parsed.instrument;
    return exchange === null ? symbol : `${symbol} (${exchange})`;
  }
  return row.parsed.note ?? row.parsed.externalId;
}

/**
 * The staged rows of one batch, reviewed one at a time. A row still waiting
 * on instrument resolution (ticket 5's own screen) has no accept/reject
 * here — it links back there instead, since `acceptImportRow` refuses an
 * unresolved row anyway. Everything else — the quick "Accept" here, and
 * reject/edit-and-accept on the row's own page — goes through the same
 * `acceptImportRow`/`rejectImportRow` use cases ticket 6 built.
 */
export default async function ImportBatchReviewListPage({
  params,
}: Readonly<{ params: Promise<{ batchId: string }> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const { batchId: rawBatchId } = await params;
  const parsedBatchId = importBatchIdSchema.safeParse(rawBatchId);
  if (!parsedBatchId.success) notFound();
  const batchId = parsedBatchId.data;

  const imports = scopedImportsFor(user.id);
  const [batch, rows, dictionary, locale] = await Promise.all([
    imports.getBatch(batchId),
    imports.rowsForBatch(batchId),
    getDictionary(),
    getLocale(),
  ]);
  if (batch === null) notFound();
  const strings = dictionary.imports.review;

  const unresolvedCount = rows.filter(
    (row) => row.parsed.instrument !== null && row.resolvedInstrumentId === null,
  ).length;

  const counts: Readonly<Record<ImportRowStatus, number>> = {
    pending: rows.filter((row) => row.status === 'pending').length,
    accepted: rows.filter((row) => row.status === 'accepted').length,
    rejected: rows.filter((row) => row.status === 'rejected').length,
    duplicate: rows.filter((row) => row.status === 'duplicate').length,
  };

  const statusLabel: Readonly<Record<ImportRowStatus, string>> = {
    pending: strings.pending,
    accepted: strings.accepted,
    rejected: strings.rejected,
    duplicate: strings.duplicate,
  };

  const newestFirst = [...rows].reverse();

  const columns: readonly DataListColumn<ImportRow>[] = [
    {
      id: 'tradeDate',
      header: strings.date,
      mobile: 'title',
      cell: (row) => (
        <span className="font-medium">{formatPlainDate(row.parsed.tradeDate, locale)}</span>
      ),
    },
    {
      id: 'description',
      header: strings.description,
      mobile: 'subtitle',
      cell: (row) => (
        <span className="truncate">
          {dictionary.transactions.types[row.parsed.type]}
          <span className="text-muted-foreground"> · {descriptionOf(row)}</span>
        </span>
      ),
    },
    {
      id: 'amount',
      header: strings.amount,
      align: 'end',
      mobile: 'value',
      cell: (row) => formatMoney(grossValueOfParsedRow(row.parsed), locale),
    },
    {
      id: 'status',
      header: dictionary.imports.status,
      align: 'end',
      mobile: 'meta',
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.status === 'pending' &&
          row.parsed.instrument !== null &&
          row.resolvedInstrumentId === null
            ? strings.resolveLink
            : statusLabel[row.status]}
        </span>
      ),
    },
    {
      id: 'action',
      header: '',
      align: 'end',
      // Desktop-only: `rowHref` below is what a phone uses to reach the same
      // place (the whole card is a link there), but the desktop table never
      // wraps a row in a link — without an explicit column there would be no
      // way to open a row's own page (reject, edit-and-accept, or a settled
      // row's outcome) from a mouse at all.
      cell: (row) => {
        const isUnresolved =
          row.status === 'pending' &&
          row.parsed.instrument !== null &&
          row.resolvedInstrumentId === null;
        if (isUnresolved) {
          return (
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/import/${batchId}` as Route} />}
            >
              {strings.resolveLink}
            </Button>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            {row.status === 'pending' && (
              <form action={acceptRowAction}>
                <input type="hidden" name="rowId" value={row.id} />
                <Button size="sm" variant="ghost" type="submit">
                  {strings.accept}
                </Button>
              </form>
            )}
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/import/${batchId}/review/${row.id}` as Route} />}
            >
              {strings.edit}
            </Button>
          </div>
        );
      },
    },
  ];

  const rowHref = (row: ImportRow): Route =>
    row.status === 'pending' && row.parsed.instrument !== null && row.resolvedInstrumentId === null
      ? (`/import/${batchId}` as Route)
      : (`/import/${batchId}/review/${row.id}` as Route);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/import" />}
          className="-ml-2 w-fit"
        >
          {strings.back}
        </Button>
        <h1 className="text-lg font-semibold">
          {interpolate(strings.title, { broker: batch.broker })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {statusLabel.pending}: {counts.pending} · {statusLabel.accepted}: {counts.accepted} ·{' '}
          {statusLabel.rejected}: {counts.rejected} · {statusLabel.duplicate}: {counts.duplicate}
        </p>
      </div>

      {unresolvedCount > 0 && (
        <div className="border-border bg-muted/30 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>
            {unresolvedCount} {strings.unresolved}
          </span>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/import/${batchId}` as Route} />}
          >
            {strings.resolveLink}
          </Button>
        </div>
      )}

      {batch.warnings.length > 0 && (
        <div className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm">
          <h2 className="text-sm font-medium">{strings.warnings}</h2>
          <ul className="text-muted-foreground list-inside list-disc">
            {batch.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <DataList
        rows={newestFirst}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={rowHref}
        empty={strings.empty}
      />
    </div>
  );
}
