'use client';

import { useActionState } from 'react';

import { uploadStatementAction, type UploadStatementState } from '@/app/(app)/import/actions';
import { Button } from '@/components/ui/button';

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

/**
 * Deliberately plain — this screen exists to prove upload → sniff → store →
 * parse → stage works end to end (ticket 4), not to be the review
 * experience. That's its own ticket, with resolved instruments, dedup, and
 * accept/reject per row; this one only ever shows a batch's own summary.
 */
export function ImportUploadForm({ accounts }: Props) {
  const [state, formAction, isPending] = useActionState(uploadStatementAction, idle);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="accountId" className="text-sm font-medium">
          Account
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
          Statement file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx"
          required
          className="border-input bg-input/30 rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? 'Uploading…' : 'Upload'}
      </Button>

      {state.status === 'error' && <p className="text-destructive text-sm">{state.message}</p>}

      {state.status === 'done' && (
        <div className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm">
          <p>
            <span className="text-muted-foreground">Status: </span>
            {state.batch.status}
          </p>
          <p>
            <span className="text-muted-foreground">Broker: </span>
            {state.batch.broker}
          </p>
          <p>
            <span className="text-muted-foreground">Rows staged: </span>
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
        </div>
      )}
    </form>
  );
}
