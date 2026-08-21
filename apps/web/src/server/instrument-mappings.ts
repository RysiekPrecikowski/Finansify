import { type Instrument, type InstrumentId, type SymbolMapping } from '@finansify/core';

import { getInstruments, getSymbols } from '@/server/container';

export interface InstrumentMappingRow {
  readonly instrument: Instrument;
  readonly chain: readonly SymbolMapping[];
}

/**
 * Every instrument with its current provider chain — the admin mapping
 * screen's list (Stage 5). Global, not scoped to a user, same reasoning as
 * `getInstruments()`/`getSymbols()` themselves (ADR 0010): there is exactly
 * one shared answer to "what does this instrument resolve to," not one per
 * viewer.
 */
export async function listInstrumentMappings(): Promise<readonly InstrumentMappingRow[]> {
  const instruments = await getInstruments().listAll();
  const chains = await getSymbols().chainFor(instruments.map((instrument) => instrument.id));
  return instruments.map((instrument) => ({
    instrument,
    chain: chains.get(instrument.id) ?? [],
  }));
}

export async function readInstrumentMapping(
  instrumentId: InstrumentId,
): Promise<InstrumentMappingRow | null> {
  const instrument = await getInstruments().findById(instrumentId);
  if (instrument === null) return null;

  const chains = await getSymbols().chainFor([instrumentId]);
  return { instrument, chain: chains.get(instrumentId) ?? [] };
}
