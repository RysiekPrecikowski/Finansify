import { calculateNetWorth } from '@finansify/core';
import { listAccounts } from '@finansify/db';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/server';

/**
 * Distinct accounts, queried straight from `accounts` rather than through any
 * portfolio join -- so an account linked into two portfolios still shows once here.
 * This is the Phase 1 checkpoint. See docs/domain.md: global totals aggregate over
 * the distinct account set.
 */
export default async function HomePage() {
  const userId = await requireUserId();
  const accounts = await listAccounts(userId);
  const netWorth = calculateNetWorth('0', '0');

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-muted-foreground text-sm">Finansify</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Ledger-first portfolio tracking
        </h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-muted-foreground text-sm">Net worth</p>
            <p className="tabular mt-1 text-2xl font-medium">{netWorth.toFixed(2)} PLN</p>
          </div>
          <div>
            <p className="text-muted-foreground text-sm">
              {accounts.length} distinct account{accounts.length === 1 ? '' : 's'}
            </p>
            {accounts.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                No accounts yet. Create one on the{' '}
                <Link href="/accounts" className="underline">
                  Accounts
                </Link>{' '}
                page, then group it into a{' '}
                <Link href="/portfolios" className="underline">
                  portfolio
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {accounts.map((account) => (
                  <li key={account.id} className="text-sm">
                    {account.name}{' '}
                    <span className="text-muted-foreground">({account.baseCurrency})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
