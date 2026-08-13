import { type Account } from '@finansify/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Route } from 'next';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { formatPlainDate } from '@/lib/format';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { scopedLedgerFor } from '@/server/container';

/**
 * The first screen in the app that reads the real ledger rather than
 * `lib/fixtures/portfolio.ts`.
 *
 * An ordinary dynamic server read: no `use cache`, because Cache Components are
 * not enabled here and a cached read over user data would need the user id in
 * its key to be safe at all (rule 5, ADR 0010).
 */
export default async function AccountsPage() {
  const user = await getCurrentUser();
  // The `(app)` layout already redirects, but this page reads user-scoped rows,
  // so it establishes the identity it scopes with rather than assuming one.
  if (user === null) redirect('/sign-in' as Route);

  const [accounts, dictionary, locale] = await Promise.all([
    // Every read goes through the scoped repository — there is no unscoped path
    // and no RLS backstop (rule 4, ADR 0009).
    scopedLedgerFor(user.id).listAccounts(),
    getDictionary(),
    getLocale(),
  ]);

  const strings = dictionary.accounts;

  const columns: readonly DataListColumn<Account>[] = [
    {
      id: 'name',
      header: strings.name,
      mobile: 'title',
      cell: (account) => <span className="font-medium">{account.name}</span>,
    },
    {
      id: 'broker',
      header: strings.broker,
      mobile: 'subtitle',
      cell: (account) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{account.broker}</span>
          {/* `outline`, never a colour: green and red mean profit and loss, and
              an account is neither (docs/ui.md). */}
          <Badge variant="outline" className="font-normal">
            {dictionary.wrappers[account.wrapper]}
          </Badge>
        </span>
      ),
    },
    {
      id: 'currency',
      header: strings.currency,
      align: 'end',
      mobile: 'value',
      cell: (account) => account.currency,
    },
    {
      id: 'openedAt',
      header: strings.openedAt,
      align: 'end',
      mobile: 'meta',
      cell: (account) => (
        <span className="text-muted-foreground">{formatPlainDate(account.openedAt, locale)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{strings.title}</h1>
        {/* `nativeButton={false}` because this renders an `<a>`: Base UI otherwise
            keeps native button semantics that an anchor does not have. */}
        <Button size="sm" nativeButton={false} render={<Link href="/accounts/new" />}>
          {strings.add}
        </Button>
      </div>

      <DataList
        rows={accounts}
        columns={columns}
        rowKey={(account) => account.id}
        empty={
          <span className="flex flex-col items-start gap-2">
            {strings.empty}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/accounts/new" />}
            >
              {strings.add}
            </Button>
          </span>
        }
      />
    </div>
  );
}
