import { accountWrapperSchema, currencyCodeSchema } from '@finansify/core';
import { listAccounts } from '@finansify/db';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireUserId } from '@/lib/auth/server';

import { createAccountAction } from './actions';

export default async function AccountsPage() {
  const userId = await requireUserId();
  const accounts = await listAccounts(userId);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>

      <Card>
        <CardHeader>
          <CardTitle>New account</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAccountAction} className="flex flex-col gap-4">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="wrapper">Wrapper</Label>
              <select
                id="wrapper"
                name="wrapper"
                defaultValue="TAXABLE"
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                {accountWrapperSchema.options.map((wrapper) => (
                  <option key={wrapper} value={wrapper}>
                    {wrapper}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">Create account</Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {accounts.length === 0 && <p className="text-muted-foreground text-sm">No accounts yet.</p>}
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{account.name}</p>
                <p className="text-muted-foreground text-sm">
                  {account.baseCurrency} &middot; {account.wrapper}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
