import { Temporal } from '@finansify/core';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { TransactionForm } from '@/components/transactions/transaction-form';
import { getCurrentUser } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n/server';
import { createTransactionAction } from '../actions';
import { loadTransactionFormOptions } from '../form-options';

export default async function NewTransactionPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const [options, dictionary] = await Promise.all([
    loadTransactionFormOptions(user.id),
    getDictionary(),
  ]);

  // A transaction cannot exist without an account to hang it on:
  // `transactions.account_id` is NOT NULL. Sending the user to build one is more
  // use than a form whose first field has nothing in it.
  if (options.accounts.length === 0) redirect('/accounts/new' as Route);

  const firstAccount = options.accounts[0]!;
  // Warsaw's today, matching what `format.ts` renders — not the browser's.
  const today = Temporal.Now.plainDateISO('Europe/Warsaw').toString();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{dictionary.transactions.add}</h1>
      <TransactionForm
        action={createTransactionAction}
        submitLabel={dictionary.transactions.save}
        accounts={options.accounts}
        instruments={options.instruments}
        shapes={options.shapes}
        values={{
          accountId: firstAccount.id,
          type: 'buy',
          instrumentId: options.instruments[0]?.id ?? 'new',
          tradeDate: today,
          settleDate: '',
          quantity: '',
          price: '',
          grossAmount: '',
          fee: '',
          tax: '',
          currency: firstAccount.currency,
          fxRate: '',
          fxRateSource: 'broker',
          note: '',
        }}
      />
    </div>
  );
}
