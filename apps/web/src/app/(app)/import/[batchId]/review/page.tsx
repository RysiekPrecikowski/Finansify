import {
  grossValueOf,
  importBatchIdSchema,
  makeDetectImportDuplicates,
  type ImportRow,
  type ImportRowId,
  type ImportRowStatus,
  type ReimportClassification,
} from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { interpolate } from '@/lib/i18n/dictionaries';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { formatMoney, formatPlainDate } from '@/lib/format';
import { scopedImportsFor, scopedLedgerFor } from '@/server/container';
import { acceptAllPendingAction, acceptRowAction } from '../../actions';
import { AcceptAllButton } from './accept-all-button';

function descriptionOf(row: ImportRow): string {
  if (row.parsed.instrument !== null) {
    const { symbol, exchange } = row.parsed.instrument;
    return exchange === null ? symbol : `${symbol} (${exchange})`;
  }
  return row.parsed.note ?? row.parsed.externalId;
}

/**
 * The status-column override for a still-`pending` row whose reimport
 * classification says accepting it will not be a plain "create a new
 * transaction" — `null` for `new` (nothing more to say than the ordinary
 * `pending` label already says) and for a row with no preview at all
 * (unresolved or needs-review, both handled by their own overrides first).
 */
function previewLabelOf(
  classification: ReimportClassification | undefined,
  strings: {
    previewUnchanged: string;
    previewChanged: string;
    previewConflict: string;
    previewDeleted: string;
  },
): string | null {
  switch (classification?.kind) {
    case 'unchanged':
      return strings.previewUnchanged;
    case 'changed':
      return strings.previewChanged;
    case 'conflict':
      return strings.previewConflict;
    case 'deleted':
      return strings.previewDeleted;
    default:
      return null;
  }
}

function isUnresolved(row: ImportRow): boolean {
  return (
    row.status === 'pending' && row.parsed.instrument !== null && row.resolvedInstrumentId === null
  );
}

/**
 * A pending `buy`/`sell` with no real fill quantity — the shape an importer
 * stages when it could not read one from the broker's own export (rather
 * than guessing; see the row's own `parsed.warnings`) and
 * `transactionInputSchema` now refuses outright, since a zero-quantity lot
 * has no meaning and previously reached `matchLots` and crashed there
 * instead of here. Deliberately narrower than "this row has any warning at
 * all" — an FX-rate-inferred trade also carries a warning but has a real,
 * acceptable quantity, and one-click accept must keep working for it.
 */
function needsReview(row: ImportRow): boolean {
  return (
    row.status === 'pending' &&
    (row.parsed.type === 'buy' || row.parsed.type === 'sell') &&
    !row.parsed.quantity.isPositive()
  );
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
  const ledger = scopedLedgerFor(user.id);
  const detectImportDuplicates = makeDetectImportDuplicates({ imports, ledger });
  const [batch, rows, duplicatesPreview, dictionary, locale] = await Promise.all([
    imports.getBatch(batchId),
    imports.rowsForBatch(batchId),
    detectImportDuplicates(batchId),
    getDictionary(),
    getLocale(),
  ]);
  if (batch === null) notFound();
  const strings = dictionary.imports.review;

  // A reimport's dedup verdict for each still-pending row, computed fresh on
  // every load rather than persisted — same "review numbers are a live
  // query, never a second copy of state" posture `docs/domain.md` already
  // takes for `import_batches`' own counts. `duplicatesPreview` only fails on
  // a malformed `batchId`, which `notFound()` above has already ruled out.
  const previewByRowId = new Map<ImportRowId, ReimportClassification>(
    duplicatesPreview.ok
      ? duplicatesPreview.value.map((preview) => [preview.rowId, preview.classification])
      : [],
  );
  const previewCounts = { new: 0, unchanged: 0, changed: 0, conflict: 0, deleted: 0 };
  for (const classification of previewByRowId.values()) previewCounts[classification.kind] += 1;
  const previewNotices = [
    previewCounts.unchanged > 0
      ? interpolate(strings.previewUnchangedCount, { count: String(previewCounts.unchanged) })
      : null,
    previewCounts.changed > 0
      ? interpolate(strings.previewChangedCount, { count: String(previewCounts.changed) })
      : null,
    previewCounts.conflict > 0
      ? interpolate(strings.previewConflictCount, { count: String(previewCounts.conflict) })
      : null,
    previewCounts.deleted > 0
      ? interpolate(strings.previewDeletedCount, { count: String(previewCounts.deleted) })
      : null,
  ].filter((notice): notice is string => notice !== null);

  const unresolvedCount = rows.filter(
    (row) => row.parsed.instrument !== null && row.resolvedInstrumentId === null,
  ).length;

  const reviewRows = rows.filter(needsReview);
  const reviewCount = reviewRows.length;
  const firstReviewRow = reviewRows[0];

  // A row that needs review can never succeed through `acceptImportRow` (the
  // schema refuses its zero quantity) — excluded here for the same reason an
  // unresolved row is: counting it would overstate what "accept all pending"
  // actually accepts, and the bulk loop would silently no-op on it instead of
  // doing anything useful.
  const acceptableCount = rows.filter(
    (row) =>
      row.status === 'pending' &&
      (row.parsed.instrument === null || row.resolvedInstrumentId !== null) &&
      !needsReview(row),
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
      cell: (row) => formatMoney(grossValueOf(row.parsed), locale),
    },
    {
      id: 'status',
      header: dictionary.imports.status,
      align: 'end',
      mobile: 'meta',
      cell: (row) => (
        <span className="text-muted-foreground">
          {isUnresolved(row)
            ? strings.resolveLink
            : needsReview(row)
              ? strings.needsReviewStatus
              : (previewLabelOf(previewByRowId.get(row.id), strings) ?? statusLabel[row.status])}
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
        if (isUnresolved(row)) {
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
            {row.status === 'pending' && !needsReview(row) && (
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
    isUnresolved(row)
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

      {previewNotices.length > 0 && (
        <div className="border-border bg-muted/30 flex flex-col gap-1 rounded-md border p-3 text-sm">
          {previewNotices.map((notice) => (
            <span key={notice}>{notice}</span>
          ))}
        </div>
      )}

      {acceptableCount > 0 && (
        <form action={acceptAllPendingAction} className="w-fit">
          <input type="hidden" name="batchId" value={batchId} />
          <AcceptAllButton count={acceptableCount} />
        </form>
      )}

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

      {reviewCount > 0 && firstReviewRow !== undefined && (
        <div className="border-border bg-muted/30 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>
            {reviewCount} {strings.needsReview}
          </span>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/import/${batchId}/review/${firstReviewRow.id}` as Route} />}
          >
            {strings.reviewLink}
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
