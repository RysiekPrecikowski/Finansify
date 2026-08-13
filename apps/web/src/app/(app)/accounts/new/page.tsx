import { Temporal } from '@finansify/core';

import { AccountForm } from '@/components/accounts/account-form';
import { getDictionary } from '@/lib/i18n/server';

export default async function NewAccountPage() {
  const dictionary = await getDictionary();

  // Computed here rather than in the client component for two reasons: the form
  // stays free of `@finansify/core` (and so of Temporal, Decimal and zod in the
  // client bundle), and "today" is Warsaw's today — the same zone `format.ts`
  // renders dates in, not whatever the browser happens to be set to.
  const today = Temporal.Now.plainDateISO('Europe/Warsaw').toString();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{dictionary.accounts.add}</h1>
      <AccountForm today={today} />
    </div>
  );
}
