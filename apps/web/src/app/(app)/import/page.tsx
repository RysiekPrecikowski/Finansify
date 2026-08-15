import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { ImportUploadForm } from '@/components/imports/import-upload-form';
import { getCurrentUser } from '@/lib/auth';
import { scopedLedgerFor } from '@/server/container';

/**
 * Ticket 4's own verification screen, not the review UI (its own ticket,
 * with resolved instruments and accept/reject per row) — this exists to
 * prove upload → sniff → store → parse → stage works against a real Blob
 * store. English-only and not linked from `/more` on purpose: it is
 * superseded wholesale once the review UI lands, and building bilingual
 * strings (docs/ui.md) for a screen with a known, short lifetime is exactly
 * the kind of design-for-the-future rule 2 argues against.
 */
export default async function ImportPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const accounts = await scopedLedgerFor(user.id).listAccounts();
  if (accounts.length === 0) redirect('/accounts/new' as Route);

  const accountOptions = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    currency: account.currency,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Import a statement</h1>
      <ImportUploadForm accounts={accountOptions} />
    </div>
  );
}
