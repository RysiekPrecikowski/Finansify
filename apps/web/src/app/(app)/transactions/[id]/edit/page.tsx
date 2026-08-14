import { transactionIdSchema } from '@finansify/core';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';

import { TransactionForm } from '@/components/transactions/transaction-form';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n/server';
import { scopedLedgerFor } from '@/server/container';
import { deleteTransactionAction, updateTransactionAction } from '../../actions';
import { loadSelectedInstrument, loadTransactionFormOptions } from '../../form-options';

/**
 * `getTransaction` resolves through the caller's own scoped repository, so a
 * transaction belonging to someone else is not "forbidden" — it is simply not
 * there, and answering 404 rather than 403 is both correct and the answer that
 * leaks nothing about what exists (rule 4, ADR 0009).
 */
export default async function EditTransactionPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const { id } = await params;
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const transaction = await scopedLedgerFor(user.id).getTransaction(parsedId.data);
  if (transaction === null) notFound();

  const [options, instrument, dictionary] = await Promise.all([
    loadTransactionFormOptions(user.id),
    loadSelectedInstrument(transaction.instrumentId),
    getDictionary(),
  ]);

  const strings = dictionary.transactions;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{strings.edit}</h1>

      <TransactionForm
        action={updateTransactionAction}
        submitLabel={strings.save}
        accounts={options.accounts}
        shapes={options.shapes}
        values={{
          id: transaction.id,
          accountId: transaction.accountId,
          type: transaction.type,
          instrument,
          tradeDate: transaction.tradeDate.toString(),
          settleDate: transaction.settleDate?.toString() ?? '',
          // `toFixed()` with no argument renders the stored decimal in full:
          // no rounding, no exponent, and never a `number` (rule 1, ADR 0005).
          quantity: transaction.quantity.toFixed(),
          price: transaction.price?.amount.toFixed() ?? '',
          grossAmount: transaction.grossAmount?.amount.toFixed() ?? '',
          fee: transaction.fee.amount.toFixed(),
          tax: transaction.tax.amount.toFixed(),
          currency: transaction.currency,
          fxRate: transaction.fxRate?.toFixed() ?? '',
          fxRateSource: transaction.fxRateSource ?? 'broker',
          note: transaction.note ?? '',
        }}
      />

      {/* A form, never a link: a GET that deletes is one prefetch away from
          deleting a row nobody asked to delete. The delete itself is soft
          (ADR 0004) — the row keeps its `deleted_at` for import idempotency. */}
      <form action={deleteTransactionAction} className="border-border border-t pt-4">
        <input type="hidden" name="id" value={transaction.id} />
        <Button type="submit" variant="outline" size="sm">
          {strings.delete}
        </Button>
        <p className="text-muted-foreground mt-2 text-xs">{strings.confirmDelete}</p>
      </form>
    </div>
  );
}
