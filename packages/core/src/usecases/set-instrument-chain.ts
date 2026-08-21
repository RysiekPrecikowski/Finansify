import { z } from 'zod';

import { type InstrumentRepository } from '../ledger/ports';
import { instrumentIdSchema } from '../ledger/types';
import { type SymbolRepository } from '../valuation/ports';
import { providerNames } from '../valuation/vocabulary';
import { failure, issuesOf, success, type UseCaseResult } from './result';

const entrySchema = z.object({
  provider: z.enum(providerNames),
  symbol: z.string().trim().min(1).max(64),
});

export const setInstrumentChainSchema = z.object({
  instrumentId: instrumentIdSchema,
  entries: z
    .array(entrySchema)
    .max(providerNames.length)
    .refine((entries) => new Set(entries.map((entry) => entry.provider)).size === entries.length, {
      message: 'Each provider can appear at most once in an instrument’s chain',
    }),
});

/**
 * An admin's whole-chain replace (Stage 5, ADR 0022's "an admin can reorder
 * it by hand") — `entries[0]` becomes the provider tried first, and the
 * submitted list *is* the new chain: an entry left out is removed, same as
 * `setChain`'s own contract.
 *
 * Existence is the only domain rule worth enforcing here. A `(provider,
 * symbol)` pair another instrument already claims is refused by `setChain`
 * itself, via the same unique constraint `save` relies on — that surfaces as
 * a thrown error rather than a returned issue, the same treatment
 * `select-instrument.ts` gives a failure that is not a user-correctable field
 * problem.
 */
export function makeSetInstrumentChain(deps: {
  instruments: InstrumentRepository;
  symbols: SymbolRepository;
}) {
  return async function setInstrumentChain(input: unknown): Promise<UseCaseResult<void>> {
    const parsed = setInstrumentChainSchema.safeParse(input);
    if (!parsed.success) return failure(issuesOf(parsed.error));

    const instrument = await deps.instruments.findById(parsed.data.instrumentId);
    if (instrument === null) {
      return failure([{ path: 'instrumentId', message: 'This instrument no longer exists' }]);
    }

    await deps.symbols.setChain(parsed.data.instrumentId, parsed.data.entries);
    return success(undefined);
  };
}
