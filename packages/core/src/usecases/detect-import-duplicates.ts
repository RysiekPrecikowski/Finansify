import { type ScopedLedgerRepository } from '../ledger/ports';
import { type ImportRowId, type ScopedImportRepository } from '../imports';

import { loadPendingImportRows } from './pending-import-rows';
import { classifyReimport, type ReimportClassification } from './reimport-classification';
import { success, type UseCaseResult } from './result';

export interface ImportRowPreview {
  readonly rowId: ImportRowId;
  readonly classification: ReimportClassification;
}

/**
 * Read-only counterpart to `acceptImportRows` — classifies every still-
 * `pending`, resolution-complete row in a batch (`new` / `unchanged` /
 * `changed` / `conflict` / `deleted`) without writing anything, so the review
 * screen can show what accepting the batch would actually do before the user
 * clicks the button. Shares `loadPendingImportRows` and `classifyReimport`
 * with `acceptImportRows` so the preview and the real accept can never
 * disagree about which row lands where.
 *
 * Numbers shown from this are never persisted: `docs/domain.md`'s framing for
 * `import_batches`' own counts applies here too — while a batch is under
 * review, the true numbers are always a live query, not a second copy of the
 * state `import_rows` already holds.
 */
export function makeDetectImportDuplicates(deps: {
  imports: ScopedImportRepository;
  ledger: ScopedLedgerRepository;
}) {
  return async function detectImportDuplicates(
    batchId: unknown,
  ): Promise<UseCaseResult<readonly ImportRowPreview[]>> {
    const loaded = await loadPendingImportRows(deps, batchId);
    if (!loaded.ok) return loaded;

    return success(
      loaded.value.pending.map(({ row, input, existing }) => ({
        rowId: row.id,
        classification: classifyReimport(existing, input),
      })),
    );
  };
}
