import { importRowIdSchema, type ImportRow, type ScopedImportRepository } from '../imports';
import { failure, success, type UseCaseResult } from './result';

/**
 * The reviewer's own choice to skip a staged row rather than accept it —
 * never something `acceptImportRow` reaches on its own (its `duplicate`
 * outcome is a dedup finding, not a rejection). Settles the row to
 * `rejected` with `reason`, leaving no transaction behind. A rejected row
 * still counts against the batch's `totalRows` — nothing here un-stages it —
 * so it stays visible in the review UI as a settled row, not a gap.
 */
export function makeRejectImportRow(deps: { imports: ScopedImportRepository }) {
  return async function rejectImportRow(
    rowId: unknown,
    reason: string,
  ): Promise<UseCaseResult<ImportRow>> {
    const parsedId = importRowIdSchema.safeParse(rowId);
    if (!parsedId.success) return failure([{ path: 'rowId', message: 'Not an import row id' }]);

    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      return failure([{ path: 'reason', message: 'A reason is required' }]);
    }

    const row = await deps.imports.getRow(parsedId.data);
    if (row === null) return failure([{ path: 'rowId', message: 'Unknown import row' }]);
    if (row.status !== 'pending') {
      return failure([{ path: 'rowId', message: 'This row has already been reviewed' }]);
    }

    const updated = await deps.imports.recordRowOutcome(row.id, {
      status: 'rejected',
      reason: trimmedReason,
    });
    return success(updated);
  };
}
