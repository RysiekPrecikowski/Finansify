import { instrumentIdSchema } from '@finansify/core';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { formatInstant } from '@/lib/format';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { readInstrumentMapping } from '@/server/instrument-mappings';
import { getPriceProviders } from '@/server/container';
import {
  ProviderChainEditor,
  type ChainEntryView,
} from '@/components/providers/provider-chain-editor';

/**
 * The admin mapping editor for one instrument (Stage 5, CU-869en2unq),
 * reached from `/more/providers`. Only providers that can actually serve
 * `spot`-only (currently every price provider but the way it's mapped in
 * `getPriceProviders()` — `spot` itself is unused, ADR 0022) is filtered
 * out here: offering it as an add option would create a mapping nothing
 * ever calls.
 */
export default async function ProviderMappingDetailPage({
  params,
}: Readonly<{ params: Promise<{ instrumentId: string }> }>) {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const { instrumentId } = await params;
  const parsedId = instrumentIdSchema.safeParse(instrumentId);
  if (!parsedId.success) notFound();

  const [mapping, dictionary, locale] = await Promise.all([
    readInstrumentMapping(parsedId.data),
    getDictionary(),
    getLocale(),
  ]);
  if (mapping === null) notFound();

  const strings = dictionary.providers;
  const { instrument, chain } = mapping;

  const availableProviders = [...getPriceProviders().values()]
    .filter((provider) => provider.capabilitiesFor(instrument.kind).history)
    .map((provider) => provider.name);

  const initialChain: readonly ChainEntryView[] = chain.map((entry) => ({
    provider: entry.provider,
    symbol: entry.symbol,
    fallbackCount: entry.fallbackCount,
    lastFallbackAt:
      entry.lastFallbackAt === null ? null : formatInstant(entry.lastFallbackAt, locale),
    verifiedAt: formatInstant(entry.verifiedAt, locale),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Button
        size="sm"
        variant="ghost"
        nativeButton={false}
        render={<Link href="/more/providers" />}
        className="-ml-2 w-fit"
      >
        {strings.back}
      </Button>

      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{instrument.symbol}</h1>
          <Badge variant="outline">{dictionary.dashboard.assetClasses[instrument.kind]}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">{instrument.name}</p>
      </header>

      <ProviderChainEditor
        instrumentId={instrument.id}
        initialChain={initialChain}
        availableProviders={availableProviders}
      />
    </div>
  );
}
