import {
  looksLikeSeriesCode,
  makeSearchInstruments,
  type InstrumentSearchProvider,
} from '@finansify/core';

import { getDictionary } from '@/lib/i18n/server';
import {
  getCatalystBondLookup,
  getInstrumentSearchProviders,
  getInstruments,
} from '@/server/container';

import { MIN_QUERY_LENGTH, type InstrumentOption } from './instrument-search-shared';

function labelOf(symbol: string, name: string, exchange: string | null): string {
  return exchange === null ? `${symbol} · ${name}` : `${symbol} · ${name} (${exchange})`;
}

/**
 * Every independent source, as a task that resolves to its own slice of
 * results and never throws — one source failing must never take the others
 * down with it. `app/api/instruments/search/route.ts` runs all of these
 * concurrently and streams each one to the client the moment it settles, so
 * nothing here needs to know or care how long any *other* task takes.
 *
 * Deliberately generic over `getInstrumentSearchProviders()` rather than one
 * task per named provider: this is the one place the web layer decides which
 * sources exist for a search, and it does so by iterating the composition
 * root's own list — nothing downstream (the route, the client component)
 * ever needs to spell out `'yahoo'` or `'bankier'` (ADR 0024's aggregator
 * existed to hide exactly that, and the per-provider Server Actions this
 * replaces had quietly bypassed it).
 */
export function buildInstrumentSearchTasks(
  query: string,
): readonly (() => Promise<readonly InstrumentOption[]>)[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  return [
    existingTask(trimmed),
    ...getInstrumentSearchProviders().map(providerTask(trimmed)),
    catalystBondsTask(trimmed),
  ];
}

/**
 * The local database — always the fastest possible answer, but not treated
 * specially for that reason; it is simply one of the sources. A hit here is
 * also *the* answer: `providerTask` redoes this same check before asking its
 * provider (`makeSearchInstruments`'s own "local first" rule), so its own
 * results come back empty whenever this one is non-empty — no shared
 * "suppress the others" flag needed, each source is self-consistent.
 */
function existingTask(trimmed: string): () => Promise<readonly InstrumentOption[]> {
  return async () => {
    try {
      const found = await getInstruments().search(trimmed);
      const existing = found.map<InstrumentOption>((instrument) => ({
        kind: 'existing',
        instrumentId: instrument.id,
        label: labelOf(instrument.symbol, instrument.name, instrument.exchange),
      }));

      // A series code is offered *alongside* an existing hit rather than
      // instead of it: a user typing `EDO0836` has no other way to reach a
      // bond. Suppressed once the series is already an instrument, since the
      // `existing` row for it is the better answer — same id, no resolver call.
      const seriesCode = trimmed.toUpperCase();
      const dictionary = await getDictionary();
      const alreadyHeld = found.some((instrument) => instrument.symbol === seriesCode);
      const bond: readonly InstrumentOption[] =
        looksLikeSeriesCode(trimmed) && !alreadyHeld
          ? [
              {
                kind: 'bond',
                seriesCode,
                label: `${seriesCode} · ${dictionary.instruments.bondName}`,
              },
            ]
          : [];

      return [...bond, ...existing];
    } catch (error) {
      console.error('Instrument search failed', error);
      return [];
    }
  };
}

function providerTask(
  trimmed: string,
): (provider: InstrumentSearchProvider) => () => Promise<readonly InstrumentOption[]> {
  return (provider) => async () => {
    try {
      const searchInstruments = makeSearchInstruments({ instruments: getInstruments(), provider });
      const result = await searchInstruments(trimmed);
      // `result.existing` is discarded here — `existingTask` owns that
      // answer. This call's own local check exists only to decide whether
      // asking `provider` was worth doing at all, which is also what makes
      // this source self-consistent without coordinating with the others.
      return result.candidates.map<InstrumentOption>((candidate) => ({
        kind: 'candidate',
        provider: candidate.provider,
        symbol: candidate.symbol,
        name: candidate.name,
        label: labelOf(candidate.symbol, candidate.name, candidate.exchange),
      }));
    } catch (error) {
      console.error(`Instrument search via ${provider.name} failed`, error);
      return [];
    }
  };
}

/**
 * Catalyst bonds — checks "already held" itself, with its own (cheap,
 * cache-backed) DB query, rather than depending on `existingTask`'s result:
 * the two tasks race, and this one must stay correct regardless of which
 * settles first.
 */
function catalystBondsTask(trimmed: string): () => Promise<readonly InstrumentOption[]> {
  return async () => {
    try {
      const [existing, catalystBonds] = await Promise.all([
        getInstruments().search(trimmed),
        getCatalystBondLookup().search(trimmed),
      ]);

      return catalystBonds
        .filter(
          (candidate) => !existing.some((instrument) => instrument.symbol === candidate.ticker),
        )
        .map<InstrumentOption>((candidate) => ({
          kind: 'catalyst_bond',
          ticker: candidate.ticker,
          label: `${candidate.ticker} · ${candidate.issuerName}`,
        }));
    } catch (error) {
      console.error('Catalyst bond search failed', error);
      return [];
    }
  };
}
