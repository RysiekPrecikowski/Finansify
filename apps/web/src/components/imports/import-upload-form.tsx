'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useActionState } from 'react';

import { uploadStatementAction, type UploadStatementState } from '@/app/(app)/import/actions';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';

const idle: UploadStatementState = { status: 'idle' };

/**
 * Plain fields only — `Account` carries `Temporal.PlainDate`, which is not a
 * value a Server Component can pass to a Client Component (React refuses it
 * at the RSC boundary, same reason `core` stays out of the browser bundle
 * everywhere else in this app).
 */
export interface AccountOption {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
}

interface Props {
  readonly accounts: readonly AccountOption[];
}

export function ImportUploadForm({ accounts }: Props) {
  const [state, formAction, isPending] = useActionState(uploadStatementAction, idle);
  const { dictionary } = useI18n();
  const strings = dictionary.imports;

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="accountId" className="text-sm font-medium">
          {strings.account}
        </label>
        <select
          id="accountId"
          name="accountId"
          required
          className="border-input bg-input/30 h-9 rounded-md border px-2.5 text-sm"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="file" className="text-sm font-medium">
          {strings.file}
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.csv"
          required
          className="border-input bg-input/30 rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? strings.uploading : strings.upload}
      </Button>

      {state.status === 'error' && <p className="text-destructive text-sm">{state.message}</p>}

      {state.status === 'done' && (
        <div className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm">
          <p>
            <span className="text-muted-foreground">{strings.status}: </span>
            {state.batch.status}
          </p>
          <p>
            <span className="text-muted-foreground">{strings.broker}: </span>
            {state.batch.broker}
          </p>
          <p>
            <span className="text-muted-foreground">{strings.rowsStaged}: </span>
            {state.batch.totalRows}
          </p>
          {state.batch.failureReason !== null && (
            <p className="text-destructive">{state.batch.failureReason}</p>
          )}
          {state.batch.warnings.length > 0 && (
            <ul className="text-muted-foreground list-inside list-disc">
              {state.batch.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {state.batch.status === 'parsed' && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={`/import/${state.batch.id}` as Route} />}
              className="self-start"
            >
              {strings.resolveInstruments}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
