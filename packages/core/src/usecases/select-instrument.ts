import { z } from 'zod';

import { type InstrumentRepository } from '../ledger/ports';
import { instrumentIdSchema, instrumentKinds, type Instrument } from '../ledger/types';
import { currency } from '../money';
import { type InstrumentSearchProvider, type SymbolRepository } from '../valuation/ports';
import { providerNames } from '../valuation/vocabulary';
import { failure, issuesOf, success, type UseCaseResult } from './result';

/**
 * What a caller may submit to pick an instrument — never free-text fields a
 * human typed by hand. `existing` names a row already in our database by id;
 * `candidate` names one search surfaced from a provider and is re-confirmed
 * (currency, exchange) before anything is persisted. There is no third case
 * that saves something unresolvable — see `makeSelectInstrument`.
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
    instrumentKind: z.enum(instrumentKinds),
    currency: z.string().trim().length(3),
    isin: z.string().trim().length(12).nullable().default(null),
    exchange: z.string().trim().max(32).nullable().default(null),
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
      kind: parsed.data.instrumentKind,
      currency: currency(parsed.data.currency),
      isin: parsed.data.isin,
      exchange: parsed.data.exchange,
    });

    if (confirmed === null) {
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
