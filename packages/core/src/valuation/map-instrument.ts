import { type Instrument } from '../ledger/types';
import { type SymbolResolver, type SymbolRepository } from './ports';
import { type ResolvedSymbol } from './types';

/**
 * Resolves one instrument to a provider symbol and persists it, or leaves it
 * for PR 6's manual mapping screen when the resolver refuses (section 06:
 * currency/exchange mismatch, or no candidate at all). Never overwrites an
 * existing mapping — a human correction in PR 6 must not be silently
 * clobbered by the next automatic attempt.
 */
export function makeMapInstrument(deps: { symbols: SymbolRepository; resolver: SymbolResolver }) {
  return async function mapInstrument(instrument: Instrument): Promise<ResolvedSymbol | null> {
    const existing = await deps.symbols.resolvedFor([instrument.id]);
    const already = existing.get(instrument.id);
    if (already !== undefined) return already;

    const resolved = await deps.resolver.resolve(instrument);
    if (resolved === null) return null;

    await deps.symbols.save(resolved);
    return resolved;
  };
}
