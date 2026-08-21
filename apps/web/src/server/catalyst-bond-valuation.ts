import {
  valueCatalystBondQuote,
  type InstrumentId,
  type InstrumentPosition,
  type PriceLookup,
} from '@finansify/core';

import { getCatalystBondTermsResolver } from '@/server/container';

/**
 * Turns a `catalyst_bond`'s raw `gpw` quote (money per 100 nominal, ADR 0023)
 * into a market value per bond, so it flows through the same `valuePositions`
 * pipeline as everything else.
 *
 * Unlike `bondPriceLookups` (retail treasury, `server/bond-valuation.ts`),
 * this does not synthesize a `PriceLookup` from nothing — a Catalyst bond
 * *is* quoted, so `rawPrices` (the normal `readPrices`/`refreshPrices` result,
 * `gpw` already in the provider chain) already has a real fresh/stale/
 * unavailable answer for it. This only adjusts the `close` on a fresh or
 * stale one; `unavailable` passes through unchanged, since there is nothing
 * to scale.
 */
export async function catalystBondPriceLookups(
  positions: readonly InstrumentPosition[],
  rawPrices: ReadonlyMap<InstrumentId, PriceLookup>,
): Promise<ReadonlyMap<InstrumentId, PriceLookup>> {
  const bonds = positions.filter((position) => position.instrument.kind === 'catalyst_bond');
  const lookups = new Map<InstrumentId, PriceLookup>();
  if (bonds.length === 0) return lookups;

  const resolver = getCatalystBondTermsResolver();

  for (const position of bonds) {
    const raw = rawPrices.get(position.instrument.id);
    if (raw === undefined) continue; // never asked for — leave it to the caller's own default
    if (raw.status === 'unavailable') {
      lookups.set(position.instrument.id, raw);
      continue;
    }

    try {
      const terms = await resolver.resolve(position.instrument.symbol);
      if (terms === null) {
        // The quote exists, but there is no nominal to scale it by — a
        // human needs to look at this instrument, not a retry.
        lookups.set(position.instrument.id, { status: 'unavailable', reason: 'unmapped' });
        continue;
      }

      lookups.set(position.instrument.id, {
        ...raw,
        close: valueCatalystBondQuote(raw.close, terms.nominal),
      });
    } catch (error) {
      // Same stance as `bondPriceLookups`: a bond this function cannot value
      // must show as unvaluable, never as the raw unscaled quote and never
      // dropped from the total (`docs/data-sources.md`).
      console.error(`Could not value Catalyst bond ${position.instrument.symbol}`, error);
      lookups.set(position.instrument.id, { status: 'unavailable', reason: 'never-fetched' });
    }
  }

  return lookups;
}
