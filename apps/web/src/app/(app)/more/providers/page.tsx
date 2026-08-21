import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { DataList, type DataListColumn } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { getCurrentUser } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n/server';
import { PROVIDER_LABELS } from '@/lib/provider-labels';
import { listInstrumentMappings, type InstrumentMappingRow } from '@/server/instrument-mappings';

/**
 * The admin mapping screen's list (Stage 5, CU-869en2unq): every instrument
 * and its current provider chain, reached from `/more`. Global data (ADR
 * 0010) — the auth check below only gates who may reach this page at all,
 * the same way `getSymbols()`/`getInstruments()` themselves carry no
 * `forUser` scoping.
 */
export default async function ProviderMappingsPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const [rows, dictionary] = await Promise.all([listInstrumentMappings(), getDictionary()]);
  const strings = dictionary.providers;

  const columns: readonly DataListColumn<InstrumentMappingRow>[] = [
    {
      id: 'instrument',
      header: strings.columns.instrument,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.instrument.symbol}</span>
          <span className="text-muted-foreground text-xs">{row.instrument.name}</span>
        </div>
      ),
      mobile: 'title',
    },
    {
      id: 'kind',
      header: strings.columns.kind,
      cell: (row) => dictionary.dashboard.assetClasses[row.instrument.kind],
      mobile: 'subtitle',
    },
    {
      id: 'chain',
      header: strings.columns.chain,
      cell: (row) =>
        row.chain.length === 0 ? (
          <span className="text-muted-foreground text-xs">{strings.unmapped}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.chain.map((entry) => (
              <Badge key={entry.provider} variant="outline">
                {PROVIDER_LABELS[entry.provider]}
              </Badge>
            ))}
          </div>
        ),
      mobile: 'value',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{strings.title}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{strings.subtitle}</p>
      </header>

      <DataList
        rows={rows}
        columns={columns}
        rowKey={(row) => row.instrument.id}
        rowHref={(row) => `/more/providers/${row.instrument.id}` as Route}
        empty={strings.empty}
      />
    </div>
  );
}
