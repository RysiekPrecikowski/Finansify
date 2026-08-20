import { importBatchIdSchema, importRowIdSchema } from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  loadSelectedInstrument,
  loadTransactionFormOptions,
} from '@/app/(app)/transactions/form-options';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentUser } from '@/lib/auth';
import { formatMoney, formatPlainDate } from '@/lib/format';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { scopedImportsFor } from '@/server/container';
import { acceptImportRowAction, acceptRowAction, rejectRowAction } from '../../../actions';

/**
 * One staged row, reviewed. A pending, resolved row gets three ways out:
 * accept it exactly as parsed, reject it with a reason, or edit it first —
 * the last one reusing `<TransactionForm>` so an import row is corrected
 * with the same fields and the same validation a hand-entered transaction
 * gets. A row already settled (by any of the three, or as a dedup conflict)
 * renders read-only — nothing here lets a reviewed row be reviewed twice.
 */
export default async function ImportRowReviewPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ batchId: string; rowId: string }>;
  searchParams: Promise<{ error?: string }>;
}>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const { batchId: rawBatchId, rowId: rawRowId } = await params;
  const parsedBatchId = importBatchIdSchema.safeParse(rawBatchId);
  const parsedRowId = importRowIdSchema.safeParse(rawRowId);
  if (!parsedBatchId.success || !parsedRowId.success) notFound();
  const batchId = parsedBatchId.data;

  const { error } = await searchParams;

  const imports = scopedImportsFor(user.id);
  const [batch, row, dictionary, locale] = await Promise.all([
    imports.getBatch(batchId),
    imports.getRow(parsedRowId.data),
    getDictionary(),
    getLocale(),
  ]);
  if (batch === null || row === null || row.batchId !== batchId) notFound();
  const strings = dictionary.imports.review;

  const backButton = (
    <Button
      size="sm"
      variant="ghost"
      nativeButton={false}
      render={<Link href={`/import/${batchId}/review` as Route} />}
      className="-ml-2 w-fit"
    >
      {strings.back}
    </Button>
  );

  if (row.status !== 'pending') {
    return (
      <div className="flex max-w-md flex-col gap-4">
        {backButton}
        <h1 className="text-lg font-semibold">{strings.row.reviewed}</h1>
        <div className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm">
          <p>
            <span className="text-muted-foreground">{dictionary.imports.status}: </span>
            {row.status === 'accepted' && strings.accepted}
            {row.status === 'rejected' && strings.rejected}
            {row.status === 'duplicate' && strings.duplicate}
          </p>
          {row.rejectionReason !== null && (
            <p className="text-muted-foreground">{row.rejectionReason}</p>
          )}
          {row.transactionId !== null && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={`/transactions/${row.transactionId}/edit` as Route} />}
              className="mt-1 self-start"
            >
              {strings.viewTransaction}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (row.parsed.instrument !== null && row.resolvedInstrumentId === null) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        {backButton}
        <p className="text-muted-foreground text-sm">
          {strings.unresolved}
          {' — '}
          <Link href={`/import/${batchId}` as Route} className="underline">
            {strings.resolveLink}
          </Link>
        </p>
      </div>
    );
  }

  const [options, instrument] = await Promise.all([
    loadTransactionFormOptions(user.id),
    loadSelectedInstrument(row.resolvedInstrumentId),
  ]);
  const accountOptions = options.accounts.filter((account) => account.id === batch.accountId);

  return (
    <div className="flex max-w-md flex-col gap-6">
      {backButton}

      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{dictionary.transactions.types[row.parsed.type]}</h1>
        <p className="text-muted-foreground text-sm">
          {formatPlainDate(row.parsed.tradeDate, locale)}
          {row.parsed.grossAmount !== null && ` · ${formatMoney(row.parsed.grossAmount, locale)}`}
        </p>
      </div>

      {row.parsed.warnings.length > 0 && (
        <ul className="text-muted-foreground list-inside list-disc text-sm">
          {row.parsed.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {error !== undefined && <p className="text-destructive text-sm">{strings.row.acceptError}</p>}

      <div className="flex items-center gap-2">
        <form action={acceptRowAction}>
          <input type="hidden" name="rowId" value={row.id} />
          <Button type="submit" size="sm">
            {strings.row.acceptAsIs}
          </Button>
        </form>
      </div>

      <form
        action={rejectRowAction}
        className="border-border flex flex-col gap-2 rounded-md border p-3"
      >
        <input type="hidden" name="rowId" value={row.id} />
        <h2 className="text-sm font-medium">{strings.row.rejectSection}</h2>
        <Textarea name="reason" rows={2} placeholder={strings.reasonPlaceholder} />
        <Button type="submit" size="sm" variant="outline" className="self-start">
          {strings.reject}
        </Button>
      </form>

      <div className="border-border flex flex-col gap-3 border-t pt-4">
        <h2 className="text-sm font-medium">{strings.row.editAndAccept}</h2>
        <TransactionForm
          action={acceptImportRowAction}
          submitLabel={strings.row.editAndAccept}
          accounts={accountOptions}
          shapes={options.shapes}
          values={{
            id: row.id,
            accountId: batch.accountId,
            type: row.parsed.type,
            instrument,
            tradeDate: row.parsed.tradeDate.toString(),
            settleDate: row.parsed.settleDate?.toString() ?? '',
            quantity: row.parsed.quantity.toFixed(),
            price: row.parsed.price?.amount.toFixed() ?? '',
            grossAmount: row.parsed.grossAmount?.amount.toFixed() ?? '',
            fee: row.parsed.fee.amount.toFixed(),
            tax: row.parsed.tax.amount.toFixed(),
            currency: row.parsed.currency,
            fxRate: row.parsed.fxRate?.toFixed() ?? '',
            // No fallback to 'broker': ADR 0021 made the rate optional, so a
            // parsed row with no fxRateSource must round-trip as genuinely
            // unset, not silently pre-select a source with no rate typed and
            // trip the "rate source with no rate" validation on save.
            fxRateSource: row.parsed.fxRateSource ?? '',
            note: row.parsed.note ?? '',
          }}
        />
      </div>
    </div>
  );
}
