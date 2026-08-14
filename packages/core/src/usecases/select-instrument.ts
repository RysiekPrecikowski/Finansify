import { z } from 'zod';

import { type InstrumentRepository } from '../ledger/ports';
import { instrumentIdSchema, type Instrument } from '../ledger/types';
import { type InstrumentSearchProvider, type SymbolRepository } from '../valuation/ports';
import { providerNames } from '../valuation/vocabulary';
import { failure, issuesOf, success, type UseCaseResult } from './result';

/**
 * What a caller may submit to pick an instrument. `existing` names a row
 * already in our database by id; `candidate` names *which listing was picked*
 * and nothing else — `provider` and `symbol`, plus a `name` used only as a
 * fallback label.
 *
 * Everything descriptive is deliberately absent. `instruments` is global
 * (ADR 0010) and `findOrCreate` returns the existing row on `(symbol,
 * exchange)` without correcting its fields, so a descriptive field the client
 * asserts is written once and then served to every other user forever. Kind,
 * currency and exchange therefore come from `confirm()`, which is the only
 * thing that has looked at the live listing. ISIN has no source at all —
 * neither `search()` nor `quote()` returns one, and ADR 0014 demoted it to a
 * soft cross-check — so accepting it would be attack surface for a field
 * nothing can fill.
 */
export const instrumentSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    instrumentId: instrumentIdSchema,
  }),
  z.object({
    kind: z.literal('candidate'),
    provider: z.enum(providerNames),
    symbol: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(200),
  }),
]);

/**
 * Turns a selection from `search-instruments` into a persisted, priceable
 * `Instrument` — the one place the resolvability invariant is enforced: a
 * `candidate` selection that `confirm()` refuses is a validation failure, not
 * a saved-but-unmapped row. There is no manual mapping screen downstream of
 * this use case; there is nothing left to map.
 *
 * A `candidate` selection also saves the `ResolvedSymbol` in the same call —
 * `confirm()` already did the work `refreshPrices` would otherwise need a
 * separate mapping pass to redo, so the instrument is priceable the moment it
 * exists rather than on its first lazy re-resolution.
 */
export function makeSelectInstrument(deps: {
  instruments: InstrumentRepository;
  symbols: SymbolRepository;
  provider: InstrumentSearchProvider;
}) {
  return async function selectInstrument(input: unknown): Promise<UseCaseResult<Instrument>> {
    const parsed = instrumentSelectionSchema.safeParse(input);
    if (!parsed.success) return failure(issuesOf(parsed.error));

    if (parsed.data.kind === 'existing') {
      const instrument = await deps.instruments.findById(parsed.data.instrumentId);
      if (instrument === null) {
        return failure([{ path: 'instrumentId', message: 'This instrument no longer exists' }]);
      }
      return success(instrument);
    }

    const confirmed = await deps.provider.confirm({
      provider: parsed.data.provider,
      symbol: parsed.data.symbol,
      name: parsed.data.name,
      kind: null,
      currency: null,
      isin: null,
      exchange: null,
    });

    if (confirmed === null) {
      return failure([
        { path: 'symbol', message: 'Could not confirm this instrument with the provider' },
      ]);
    }

    // `ConfirmedCandidate` narrows these at compile time, which an adapter can
    // satisfy by assertion. They decide what every later price fetch is
    // compared against, and a null reaching `instruments` would be persisted
    // globally, so they are checked here too rather than trusted.
    if (confirmed.currency === null || confirmed.kind === null) {
      return failure([
        { path: 'symbol', message: 'Could not confirm this instrument with the provider' },
      ]);
    }

    const instrument = await deps.instruments.findOrCreate({
      symbol: confirmed.symbol,
      name: confirmed.name,
      kind: confirmed.kind,
      currency: confirmed.currency,
      isin: confirmed.isin,
      exchange: confirmed.exchange,
    });

    await deps.symbols.save({
      instrumentId: instrument.id,
      provider: confirmed.provider,
      symbol: confirmed.symbol,
      currency: confirmed.currency,
    });

    return success(instrument);
  };
}
