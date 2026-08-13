import {
  instrumentIdSchema,
  makeListPositions,
  type AccountPositionLine,
  type Lot,
} from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import {
  directionOf,
  directionText,
  formatMoney,
  formatPlainDate,
  formatQuantity,
} from '@/lib/format';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import { getInstruments, scopedLedgerFor } from '@/server/container';

/**
 * The lots behind one instrument position, reached from `/portfolio` — the
 * drill-down `docs/ui.md` promises instead of an expandable row, because
 * `<DataList>` has no expansion state to hook into (it is a server component).
 *
 * `makeListPositions` is reused rather than a second query path: this page
 * asks the same read model for the one instrument it needs, exactly the way
 * `getTransaction` is reused instead of a bespoke lookup on the transactions
 * screen.
 */
export default async function PositionDetailPage({
  params,
}: Readonly<{ params: Promise<{ instrumentId: string }> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const { instrumentId } = await params;
  const parsedId = instrumentIdSchema.safeParse(instrumentId);
  if (!parsedId.success) notFound();

  const ledger = scopedLedgerFor(user.id);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });

  const [view, dictionary, locale] = await Promise.all([
    listPositions(),
    getDictionary(),
    getLocale(),
  ]);

  // Not scoped by a second query — `open` and `closed` already come from this
  // user's own ledger, so a foreign id is simply absent here, same as a
  // foreign transaction id 404s rather than 403s elsewhere in the app.
  const position = [...view.open, ...view.closed].find(
    (candidate) => candidate.instrument.id === parsedId.data,
  );
  if (position === undefined) notFound();

  const strings = dictionary.portfolio;

  const lotColumns: readonly DataListColumn<Lot>[] = [
    {
      id: 'openedOn',
      header: strings.lots.openedOn,
      mobile: 'title',
      cell: (lot) => formatPlainDate(lot.openedOn, locale),
    },
    {
      id: 'quantity',
      header: strings.lots.remainingQuantity,
      align: 'end',
      mobile: 'subtitle',
      cell: (lot) => (
        <>
          {formatQuantity(lot.remainingQuantity.toFixed(), locale)}
          <span className="text-muted-foreground">
            {' / '}
            {formatQuantity(lot.originalQuantity.toFixed(), locale)}
          </span>
        </>
      ),
    },
    {
      id: 'originalCost',
      header: strings.lots.originalCost,
      align: 'end',
      cell: (lot) => formatMoney(lot.originalCost, locale),
    },
    {
      id: 'remainingCost',
      header: strings.lots.remainingCost,
      align: 'end',
      mobile: 'value',
      cell: (lot) => formatMoney(lot.remainingCost, locale),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/portfolio" />}
          className="-ml-2 w-fit"
        >
          {strings.lots.back}
        </Button>
        <h1 className="text-lg font-semibold">{position.instrument.symbol}</h1>
        <p className="text-muted-foreground text-sm">{position.instrument.name}</p>
      </div>

      <div className="flex flex-col gap-4">
        {position.lines.map((line: AccountPositionLine) => (
          <section key={line.account.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">{line.account.name}</h2>
              <Badge variant="outline" className="font-normal">
                {dictionary.wrappers[line.account.wrapper]}
              </Badge>
            </div>

            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">{strings.quantity}</dt>
                <dd className="tabular-nums">{formatQuantity(line.quantity.toFixed(), locale)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{strings.costBasis}</dt>
                <dd className="tabular-nums">{formatMoney(line.costBasis, locale)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{strings.realized}</dt>
                <dd className={cn('tabular-nums', directionText[directionOf(line.realized)])}>
                  {formatMoney(line.realized, locale, { signed: true })}
                </dd>
              </div>
            </dl>

            <DataList
              rows={line.lots}
              columns={lotColumns}
              rowKey={(lot) => lot.id}
              className="border-border rounded-md border"
            />
          </section>
        ))}
      </div>
    </div>
  );
}
