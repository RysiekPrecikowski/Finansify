import { listAccountsForPortfolio, listUnlinkedAccounts } from '@finansify/db';
import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/server';

import { linkAccountAction, unlinkAccountAction } from '../actions';

export default async function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: portfolioId } = await params;
  const userId = await requireUserId();

  const result = await listAccountsForPortfolio(userId, portfolioId);
  if (!result) notFound();
  const { portfolio, accounts } = result;

  const unlinkedAccounts = await listUnlinkedAccounts(userId, portfolioId);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{portfolio.name}</h1>
        <p className="text-muted-foreground text-sm">{portfolio.baseCurrency}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Linked accounts</h2>
        {accounts.length === 0 && (
          <p className="text-muted-foreground text-sm">No accounts linked yet.</p>
        )}
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{account.name}</p>
                <p className="text-muted-foreground text-sm">
                  {account.baseCurrency} &middot; {account.wrapper}
                </p>
              </div>
              <form action={unlinkAccountAction}>
                <input type="hidden" name="portfolioId" value={portfolioId} />
                <input type="hidden" name="accountId" value={account.id} />
                <Button type="submit" variant="outline" size="sm">
                  Unlink
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      {unlinkedAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Link an account</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={linkAccountAction} className="flex items-center gap-3">
              <input type="hidden" name="portfolioId" value={portfolioId} />
              <select
                name="accountId"
                required
                className="border-input h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
              >
                {unlinkedAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.baseCurrency})
                  </option>
                ))}
              </select>
              <Button type="submit">Link</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
