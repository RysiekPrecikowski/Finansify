import { type InstrumentKind } from '../ledger/types';
import { type PriceProvider } from './ports';
import { type ResolvedSymbol } from './types';
import { type ProviderName } from './vocabulary';

/**
 * The whole routing behaviour (ADR 0022), in two functions:
 *
 * - `selectProvider` answers "which of this chain can serve this need at
 *   all" — capability is per `InstrumentKind`, not global, so a spot-only
 *   provider (bankier for an equity) is filtered out before anything is
 *   attempted, and a chain with nothing capable comes back empty rather than
 *   letting a caller try and fail.
 * - `fetchWithFallback` walks the capable candidates **in chain order**,
 *   first success wins. Failing over is never sticky: nothing here reorders
 *   or remembers a chain across calls, so the next call always starts from
 *   the top again — the counter a caller records via `fallenBackFrom` is for
 *   an admin to see a provider failing repeatedly, not a mechanism that
 *   changes routing.
 */
export function selectProvider(
  chain: readonly ResolvedSymbol[],
  registry: ReadonlyMap<ProviderName, PriceProvider>,
  kind: InstrumentKind,
  need: 'history' | 'spot',
): readonly ResolvedSymbol[] {
  return chain.filter((entry) => {
    const provider = registry.get(entry.provider);
    if (provider === undefined) return false;
    const capabilities = provider.capabilitiesFor(kind);
    return need === 'history' ? capabilities.history : capabilities.spot;
  });
}

export interface ChainOutcome<T> {
  readonly value: T;
  readonly source: ProviderName;
  /** Every provider in the chain that was tried before `source` and failed — in the order they were tried. */
  readonly fallenBackFrom: readonly ProviderName[];
}

/**
 * Tries each provider `selectProvider` returns, in order, until `attempt`
 * resolves. Returns `null` — never throws — when the chain has no capable
 * provider, or every capable one fails: a caller reports that as its own
 * `failed`/`unmapped` outcome rather than treating a routing dead end as an
 * unexpected error.
 */
export async function fetchWithFallback<T>(
  chain: readonly ResolvedSymbol[],
  registry: ReadonlyMap<ProviderName, PriceProvider>,
  kind: InstrumentKind,
  need: 'history' | 'spot',
  attempt: (provider: PriceProvider, ref: ResolvedSymbol) => Promise<T>,
): Promise<ChainOutcome<T> | null> {
  const candidates = selectProvider(chain, registry, kind, need);
  const fallenBackFrom: ProviderName[] = [];

  for (const entry of candidates) {
    // `selectProvider` only returns entries whose provider is registered.
    const provider = registry.get(entry.provider)!;
    try {
      const value = await attempt(provider, entry);
      return { value, source: entry.provider, fallenBackFrom };
    } catch {
      fallenBackFrom.push(entry.provider);
    }
  }

  return null;
}
