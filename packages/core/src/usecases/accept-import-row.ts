import { type ScopedLedgerRepository } from '../ledger/ports';
import { importRowIdSchema, type ImportRow, type ScopedImportRepository } from '../imports';
import { type ParsedRow } from '../ports/statement-parser';
import { failure, success, type UseCaseResult } from './result';
import { validateTransactionInput } from './record-transaction';

/**
 * `ParsedRow`'s value objects, restated as the string-based shape
 * `transactionInputSchema` expects — the same conversion `packages/db`'s
 * `serializeParsedRow` does for JSONB storage, done here instead because a use
 * case in `core` cannot import from `db` and the two serve different callers.
 *
 * Deliberately untyped as `TransactionInput` (its `accountId`/`instrumentId`
 * are branded): this is `unknown` as far as `validateTransactionInput` is
 * concerned, and re-parsing it through `transactionInputSchema` there is the
 * same defense-in-depth every manual submission goes through, not a step this
 * use case gets to skip just because the source was a trusted parser.
 */
function transactionInputFromParsedRow(
  parsed: ParsedRow,
  resolvedInstrumentId: string | null,
  accountId: string,
): Record<string, unknown> {
  return {
    accountId,
    instrumentId: resolvedInstrumentId,
    type: parsed.type,
    tradeDate: parsed.tradeDate.toString(),
    settleDate: parsed.settleDate?.toString() ?? null,
    quantity: parsed.quantity.toString(),
    price: parsed.price?.amount.toString() ?? null,
    grossAmount: parsed.grossAmount?.amount.toString() ?? null,
    fee: parsed.fee.amount.toString(),
    tax: parsed.tax.amount.toString(),
    currency: parsed.currency,
    fxRate: parsed.fxRate?.toString() ?? null,
    fxRateSource: parsed.fxRateSource,
    note: parsed.note,
  };
}

const CONFLICT_REASON =
  'This transaction was edited by hand since it was imported — the re-import was not applied.';

/**
 * Accepts one staged row: resolves the dedup/conflict question against
 * `(account_id, external_id)` and either creates, refreshes, or leaves alone
 * the transaction it names — never both a create and an update for the same
 * `external_id` (ADR 0004, rule 6's dedup half of ADR 0015).
 *
 * Three outcomes, all ending with the row settled out of `pending`:
 * - No existing transaction for this `external_id` → create one, `accepted`.
 * - One exists and was never hand-edited → refresh it in place with the
 *   restated import data, `accepted`. A broker's re-export is assumed more
 *   authoritative than a stale first import, right up until a human touches
 *   the row.
 * - One exists and `editedAfterImport` is `true` → leave it untouched,
 *   `duplicate` with a reason. Silently overwriting a hand correction is
 *   exactly what `editedAfterImport` exists to prevent.
 *
 * A row whose `parsed.instrument` is set but not yet `resolvedInstrumentId`
 * is refused — instrument resolution (its own ticket) has to finish first,
 * unless `overrides.instrumentId` supplies one right here (the review UI's
 * edit-and-accept form can pick an instrument in the same submit). A row with
 * no instrument candidate at all (a cash line: deposit, fee, tax, interest)
 * never needed resolution and sails through with `instrumentId: null`.
 *
 * `overrides` is what the review UI's edit-and-accept form contributes —
 * the same fields a hand-entered transaction submits, laid over the values
 * `ParsedRow` would otherwise supply. `accountId` and `instrumentId` are
 * never taken from it directly: `accountId` is always the batch's own
 * account (a row cannot be re-pointed at a different one a form happened to
 * submit), and `instrumentId` is folded into the instrument-resolved check
 * above before the merge, so both land in `validateTransactionInput` exactly
 * once, from one place.
 */
export function makeAcceptImportRow(deps: {
  imports: ScopedImportRepository;
  ledger: ScopedLedgerRepository;
}) {
  return async function acceptImportRow(
    rowId: unknown,
    overrides?: Record<string, unknown>,
  ): Promise<UseCaseResult<ImportRow>> {
    const parsedId = importRowIdSchema.safeParse(rowId);
    if (!parsedId.success) return failure([{ path: 'rowId', message: 'Not an import row id' }]);

    const row = await deps.imports.getRow(parsedId.data);
    if (row === null) return failure([{ path: 'rowId', message: 'Unknown import row' }]);
    if (row.status !== 'pending') {
      return failure([{ path: 'rowId', message: 'This row has already been reviewed' }]);
    }

    const resolvedInstrumentId =
      overrides !== undefined && 'instrumentId' in overrides
        ? (overrides.instrumentId as string | null)
        : row.resolvedInstrumentId;
    if (row.parsed.instrument !== null && resolvedInstrumentId === null) {
      return failure([{ path: 'rowId', message: 'Resolve this row’s instrument first' }]);
    }

    const batch = await deps.imports.getBatch(row.batchId);
    if (batch === null) return failure([{ path: 'rowId', message: 'Unknown import batch' }]);

    const rawInput = transactionInputFromParsedRow(
      row.parsed,
      resolvedInstrumentId,
      batch.accountId,
    );
    const merged =
      overrides === undefined
        ? rawInput
        : {
            ...rawInput,
            ...overrides,
            accountId: batch.accountId,
            instrumentId: resolvedInstrumentId,
          };
    const validated = await validateTransactionInput(deps.ledger, merged);
    if (!validated.ok) return validated;

    const existing = await deps.ledger.findByExternalId(batch.accountId, row.parsed.externalId);

    if (existing === null) {
      const transaction = await deps.ledger.createImportedTransaction(validated.value, {
        externalId: row.parsed.externalId,
        importBatchId: batch.id,
      });
      const updated = await deps.imports.recordRowOutcome(row.id, {
        status: 'accepted',
        transactionId: transaction.id,
      });
      return success(updated);
    }

    if (!existing.editedAfterImport) {
      const transaction = await deps.ledger.refreshImportedTransaction(
        existing.id,
        validated.value,
      );
      const updated = await deps.imports.recordRowOutcome(row.id, {
        status: 'accepted',
        transactionId: transaction.id,
      });
      return success(updated);
    }

    const updated = await deps.imports.recordRowOutcome(row.id, {
      status: 'duplicate',
      transactionId: existing.id,
      reason: CONFLICT_REASON,
    });
    return success(updated);
  };
}
