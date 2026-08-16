import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { ImportUploadForm } from '@/components/imports/import-upload-form';
import { getCurrentUser } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n/server';
import { scopedLedgerFor } from '@/server/container';

/**
 * Upload → sniff → store → parse → stage. From here the flow continues to
 * `/import/[batchId]` (resolve instruments) and `/import/[batchId]/review`
 * (accept/reject/edit each row) — this screen only ever starts a batch.
 */
export default async function ImportPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const [accounts, dictionary] = await Promise.all([
    scopedLedgerFor(user.id).listAccounts(),
    getDictionary(),
  ]);
  if (accounts.length === 0) redirect('/accounts/new' as Route);

  const accountOptions = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    currency: account.currency,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{dictionary.imports.title}</h1>
      <ImportUploadForm accounts={accountOptions} />
    </div>
  );
}
