import { type InstrumentRepository } from '../ledger/ports';
import { instrumentInputSchema, type Instrument } from '../ledger/types';
import { currency } from '../money';
import { failure, issuesOf, success, type UseCaseResult } from './result';

/**
 * Instruments are global and shared between users (`docs/domain.md`), so this
 * takes the unscoped `InstrumentRepository` and there is no ownership to check.
 * Dedup is the adapter's job — `findOrCreate` is one row per `(symbol,
 * exchange)` — which is why submitting the same symbol twice is not an error
 * here, it is the same instrument.
 */
export function makeResolveInstrument(deps: { instruments: InstrumentRepository }) {
  return async function resolveInstrument(input: unknown): Promise<UseCaseResult<Instrument>> {
    const parsed = instrumentInputSchema.safeParse(input);
    if (!parsed.success) return failure(issuesOf(parsed.error));

    return success(
      await deps.instruments.findOrCreate({
        symbol: parsed.data.symbol,
        name: parsed.data.name,
        kind: parsed.data.kind,
        currency: currency(parsed.data.currency),
        isin: parsed.data.isin,
        exchange: parsed.data.exchange,
      }),
    );
  };
}
