import { type InstrumentRepository } from '../ledger/ports';
import { type Instrument } from '../ledger/types';
import {
  groupInstrumentCandidates,
  importBatchIdSchema,
  type ImportInstrumentCandidateGroup,
  type ScopedImportRepository,
} from '../imports';
import { failure, success, type UseCaseResult } from './result';

export interface MatchedInstrumentCandidateGroup extends ImportInstrumentCandidateGroup {
  /**
   * An exact `(symbol, exchange)` hit already in our own `instruments` table —
   * `null` for a group that is already `resolvedInstrumentId`-resolved, or one
   * with no unambiguous local match. Never a provider search result: a
   * provider hit still needs `selectInstrument` to `findOrCreate` it before
   * anything can point at it, which only happens once the user actually picks
   * it (manual fallback, instrument-resolution UI).
   */
  readonly suggested: Instrument | null;
}

/**
 * The auto-resolve half of the instrument-resolution UI: groups a batch's
 * parsed rows by distinct ticker, then checks each unresolved group against
 * `InstrumentRepository.search` for an exact symbol (and exchange, when the
 * parser gave one) match. A suggestion is never written back here — bulk
 * confirmation is a separate, explicit `resolveInstruments` call, so there is
 * no path where a guess reaches `import_rows` without the user seeing it
 * first (rule 7's spirit: a match is not an assumption).
 */
export function makeMatchImportInstruments(deps: {
  imports: ScopedImportRepository;
  instruments: InstrumentRepository;
}) {
  return async function matchImportInstruments(
    batchId: unknown,
  ): Promise<UseCaseResult<readonly MatchedInstrumentCandidateGroup[]>> {
    const parsedId = importBatchIdSchema.safeParse(batchId);
    if (!parsedId.success) return failure([{ path: 'batchId', message: 'Not an import batch id' }]);

    const rows = await deps.imports.rowsForBatch(parsedId.data);
    const groups = groupInstrumentCandidates(rows);

    const matched = await Promise.all(
      groups.map(async (group): Promise<MatchedInstrumentCandidateGroup> => {
        if (group.resolvedInstrumentId !== null) return { ...group, suggested: null };

        const hits = await deps.instruments.search(group.symbol);
        const exact = hits.filter(
          (instrument) =>
            instrument.symbol.toUpperCase() === group.symbol.toUpperCase() &&
            (group.exchange === null || instrument.exchange === group.exchange),
        );

        return { ...group, suggested: exact.length === 1 ? exact[0]! : null };
      }),
    );

    return success(matched);
  };
}
