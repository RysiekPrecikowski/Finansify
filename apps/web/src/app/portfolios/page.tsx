import { currencyCodeSchema } from '@finansify/core';
import { listPortfolios } from '@finansify/db';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireUserId } from '@/lib/auth/server';

import { createPortfolioAction } from './actions';

export default async function PortfoliosPage() {
  const userId = await requireUserId();
  const portfolios = await listPortfolios(userId);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Portfolios</h1>

      <Card>
        <CardHeader>
          <CardTitle>New portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createPortfolioAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="baseCurrency">Base currency</Label>
              <select
                id="baseCurrency"
                name="baseCurrency"
                required
                defaultValue="PLN"
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                {currencyCodeSchema.options.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">Create portfolio</Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {portfolios.length === 0 && (
          <p className="text-muted-foreground text-sm">No portfolios yet.</p>
        )}
        {portfolios.map((portfolio) => (
          <Link key={portfolio.id} href={`/portfolios/${portfolio.id}`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{portfolio.name}</p>
                  <p className="text-muted-foreground text-sm">{portfolio.baseCurrency}</p>
                </div>
                <p className="text-muted-foreground text-sm">
                  {portfolio.portfolioAccounts.length} account
                  {portfolio.portfolioAccounts.length === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
