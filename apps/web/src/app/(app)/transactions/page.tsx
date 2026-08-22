import { grossValueOf, type Instrument, type Transaction } from '@finansify/core';
import { Plus } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DataList, type DataListColumn } from '@/components/data-list';
import {
  instrumentLabel,
  TransactionRow,
  TypeBadge,
} from '@/components/transactions/transaction-row';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { formatMoney, formatPlainDate } from '@/lib/format';
import { plural } from '@/lib/i18n/dictionaries';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { getInstruments, scopedLedgerFor } from '@/server/container';

/**
 * The ledger, as a list. An ordinary dynamic server read — no `use cache`,
 * because Cache Components are not enabled here and a cached read over user data
 * would need the user id in its key to be safe at all (rule 5, ADR 0010).
 *
 * Nothing on this page is green or red: a transaction is neither a gain nor a
 * loss, and colour is reserved for P&L (`docs/ui.md`).
 */
export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const ledger = scopedLedgerFor(user.id);
  const [transactions, accounts, instruments, dictionary, locale] = await Promise.all([
    ledger.listTransactions(),
    ledger.listAccounts(),
    getInstruments().listAll(),
    getDictionary(),
    getLocale(),
  ]);

  const strings = dictionary.transactions;

  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const symbolOf = new Map<Instrument['id'], string>(
    instruments.map((instrument) => [instrument.id, instrument.symbol]),
  );

  // The port returns oldest first, which is what `buildPositions` needs; a
  // reader wants the newest at the top. Reversing a copy here keeps both, and
  // changing the port's contract to suit one screen would not.
  const newestFirst = [...transactions].reverse();

  const columns: readonly DataListColumn<Transaction>[] = [
    {
      id: 'tradeDate',
      header: strings.tradeDate,
      mobile: 'title',
      cell: (transaction) => (
        <span className="font-medium">{formatPlainDate(transaction.tradeDate, locale)}</span>
      ),
    },
    {
      id: 'type',
      header: strings.type,
      mobile: 'subtitle',
      cell: (transaction) => (
        <span className="flex items-center gap-1.5 truncate">
          <TypeBadge transaction={transaction} strings={strings} />
          <span className="text-muted-foreground truncate">
            {accountName.get(transaction.accountId) ?? strings.unknownAccount}
          </span>
        </span>
      ),
    },
    {
      id: 'amount',
      header: strings.amount,
      align: 'end',
      mobile: 'value',
      cell: (transaction) => formatMoney(grossValueOf(transaction), locale),
    },
    {
      id: 'instrument',
      header: strings.instrument,
      align: 'end',
      mobile: 'meta',
      cell: (transaction) => (
        <span className="text-muted-foreground">{instrumentLabel(transaction, symbolOf)}</span>
      ),
    },
    {
      id: 'fee',
      header: strings.fee,
      align: 'end',
      cell: (transaction) => formatMoney(transaction.fee, locale),
    },
    {
      id: 'note',
      header: strings.note,
      cell: (transaction) => (
        <span className="text-muted-foreground line-clamp-1">{transaction.note ?? ''}</span>
      ),
    },
    {
      id: 'edit',
      header: '',
      align: 'end',
      cell: (transaction) => (
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href={`/transactions/${transaction.id}/edit` as Route} />}
        >
          {strings.edit}
        </Button>
      ),
    },
  ];

  // Without an account there is nothing to point a transaction at:
  // `transactions.account_id` is NOT NULL, and `buildPositions` throws
  // `UnknownAccountError` for a row whose account it was not given.
  const empty =
    accounts.length === 0 ? (
      <span className="flex flex-col items-start gap-2">
        {strings.needsAccount}
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/accounts" />}>
          {dictionary.accounts.add}
        </Button>
      </span>
    ) : (
      <span className="flex flex-col items-start gap-2">
        {strings.empty}
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/transactions/new" />}
        >
          {strings.add}
        </Button>
      </span>
    );

  return (
    // No page `<h1>`: the app bar carries the screen name
    // (`components/header-title.tsx`), same as every other screen since the
    // redesign.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-[0.6875rem] font-medium">
          {newestFirst.length > 0 &&
            `${plural(strings.transactionCount, newestFirst.length, locale)} · ${strings.newestFirst}`}
        </span>
        {accounts.length > 0 && (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/transactions/new" />}
            className="shrink-0 gap-1.5 rounded-full"
          >
            <Plus className="size-4" aria-hidden />
            {strings.add}
          </Button>
        )}
      </div>

      <DataList
        rows={newestFirst}
        columns={columns}
        rowKey={(transaction) => transaction.id}
        // The edit column below is desktop-only — it claims no mobile slot,
        // and all four are spoken for by the row's data. Without this the
        // phone layout has no way to open a transaction at all.
        rowHref={(transaction) => `/transactions/${transaction.id}/edit` as Route}
        empty={empty}
        mobileCard={(transaction) => (
          <TransactionRow
            transaction={transaction}
            accountLabel={accountName.get(transaction.accountId) ?? strings.unknownAccount}
            symbolOf={symbolOf}
            locale={locale}
            strings={strings}
          />
        )}
      />

      {newestFirst.length > 0 && (
        <p className="text-muted-foreground text-xs">{strings.grossNote}</p>
      )}
    </div>
  );
}
