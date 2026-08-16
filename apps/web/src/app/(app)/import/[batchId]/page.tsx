import { importBatchIdSchema, makeMatchImportInstruments } from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { InstrumentCombobox } from '@/components/instruments/instrument-combobox';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { interpolate } from '@/lib/i18n/dictionaries';
import { getDictionary } from '@/lib/i18n/server';
import { getInstruments, scopedImportsFor } from '@/server/container';
import { confirmAutoMatchesAction, confirmManualMatchAction } from '../actions';

function groupKey(symbol: string, exchange: string | null): string {
  return `${symbol}:${exchange ?? ''}`;
}

function tickerLabel(symbol: string, exchange: string | null): string {
  return exchange === null ? symbol : `${symbol} (${exchange})`;
}

/**
 * Auto-resolve every distinct ticker in a parsed statement against
 * `InstrumentRepository`, confirm the guesses in bulk, and fall back to the
 * same instrument search `/transactions/new` uses when auto-match can't. No
 * accept/reject-per-row and no dedup here — that's `/import/[batchId]/review`;
 * this screen only ever gets a batch's rows pointed at a real `Instrument`.
 */
export default async function ImportBatchReviewPage({
  params,
}: Readonly<{ params: Promise<{ batchId: string }> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const { batchId: rawBatchId } = await params;
  const parsedBatchId = importBatchIdSchema.safeParse(rawBatchId);
  if (!parsedBatchId.success) notFound();
  const batchId = parsedBatchId.data;

  const imports = scopedImportsFor(user.id);
  const [batch, dictionary] = await Promise.all([imports.getBatch(batchId), getDictionary()]);
  if (batch === null) notFound();
  const strings = dictionary.imports.resolve;

  const matchImportInstruments = makeMatchImportInstruments({
    imports,
    instruments: getInstruments(),
  });
  const matched = await matchImportInstruments(batchId);
  if (!matched.ok) notFound();

  const groups = matched.value;
  const resolved = groups.filter((group) => group.resolvedInstrumentId !== null);
  const autoMatched = groups.filter(
    (group) => group.resolvedInstrumentId === null && group.suggested !== null,
  );
  const needsManual = groups.filter(
    (group) => group.resolvedInstrumentId === null && group.suggested === null,
  );
  const rowCountLabel = (rowCount: number): string =>
    rowCount === 1 ? strings.row : interpolate(strings.rows, { count: String(rowCount) });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/import" />}
          className="-ml-2 w-fit"
        >
          {strings.back}
        </Button>
        <h1 className="text-lg font-semibold">
          {interpolate(strings.title, { broker: batch.broker })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {interpolate(strings.progress, {
            resolved: String(resolved.length),
            total: String(groups.length),
          })}
        </p>
      </div>

      {groups.length === 0 && <p className="text-muted-foreground text-sm">{strings.empty}</p>}

      {autoMatched.length > 0 && (
        <form action={confirmAutoMatchesAction} className="flex flex-col gap-3">
          <input type="hidden" name="batchId" value={batchId} />
          <h2 className="text-sm font-medium">{strings.autoMatched}</h2>
          <div className="flex flex-col gap-2">
            {autoMatched.map((group) => (
              <label
                key={groupKey(group.symbol, group.exchange)}
                className="border-border flex items-start gap-2 rounded-md border p-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  name="resolutions"
                  value={JSON.stringify({
                    symbol: group.symbol,
                    exchange: group.exchange,
                    instrumentId: group.suggested!.id,
                  })}
                  defaultChecked
                  className="mt-0.5"
                />
                <span className="flex flex-col">
                  <span>
                    {tickerLabel(group.symbol, group.exchange)} →{' '}
                    <span className="font-medium">
                      {group.suggested!.symbol} · {group.suggested!.name}
                    </span>
                  </span>
                  <span className="text-muted-foreground">{rowCountLabel(group.rowCount)}</span>
                </span>
              </label>
            ))}
          </div>
          <Button type="submit" className="self-start">
            {strings.confirmSelected}
          </Button>
        </form>
      )}

      {needsManual.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">{strings.needsInput}</h2>
          {needsManual.map((group) => (
            <form
              key={groupKey(group.symbol, group.exchange)}
              action={confirmManualMatchAction}
              className="border-border flex flex-col gap-3 rounded-md border p-3"
            >
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="symbol" value={group.symbol} />
              <input type="hidden" name="exchange" value={group.exchange ?? ''} />
              <p className="text-sm">
                <span className="font-medium">{tickerLabel(group.symbol, group.exchange)}</span>
                {group.name !== null && (
                  <span className="text-muted-foreground"> · {group.name}</span>
                )}
                <span className="text-muted-foreground"> — {rowCountLabel(group.rowCount)}</span>
              </p>
              <InstrumentCombobox initial={null} errors={undefined} />
              <Button type="submit" size="sm" className="self-start">
                {strings.resolveAction}
              </Button>
            </form>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">{strings.resolved}</h2>
          <ul className="text-muted-foreground list-inside list-disc text-sm">
            {resolved.map((group) => (
              <li key={groupKey(group.symbol, group.exchange)}>
                {tickerLabel(group.symbol, group.exchange)} — {rowCountLabel(group.rowCount)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resolved.length === groups.length && (
        <Button
          nativeButton={false}
          render={<Link href={`/import/${batchId}/review` as Route} />}
          className="self-start"
        >
          {strings.continueToReview}
        </Button>
      )}
    </div>
  );
}
