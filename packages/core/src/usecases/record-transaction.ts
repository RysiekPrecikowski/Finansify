import { type ScopedLedgerRepository } from '../ledger/ports';
import {
  transactionIdSchema,
  transactionInputSchema,
  transactionInputSchemaFor,
  type Transaction,
  type TransactionInput,
} from '../ledger/types';
import { failure, issuesOf, success, type FieldIssue, type UseCaseResult } from './result';

/**
 * Validating a transaction takes two passes, because the rule that matters most
 * is not expressible in one.
 *
 * The first pass is the shape: without it the account id is not even readable.
 * The second pass is `transactionInputSchemaFor(account.currency)`, which is
 * where rule 6 lives — a transaction in a currency other than its account's
 * needs the rate **as executed** (ADR 0006).
 *
 * Looking the account up in between is what proves the account belongs to the
 * caller: `listAccounts()` is already scoped, so another user's account is
 * simply not in the list. Without this the row would still be unreadable by its
 * victim (every query filters on `user_id`), but it would be a foreign
 * `account_id` in the caller's ledger — an integrity hole the FK does not
 * close, because the FK is global and only `user_id` is scoped (ADR 0009).
 */
export async function validateTransactionInput(
  ledger: ScopedLedgerRepository,
  input: unknown,
): Promise<UseCaseResult<TransactionInput>> {
  const shape = transactionInputSchema.safeParse(input);
  if (!shape.success) return failure(issuesOf(shape.error));

  const accounts = await ledger.listAccounts();
  const account = accounts.find((candidate) => candidate.id === shape.data.accountId);
  if (account === undefined) {
    return failure([{ path: 'accountId', message: 'Unknown account' }]);
  }

  const withFxRules = transactionInputSchemaFor(account.currency).safeParse(input);
  if (!withFxRules.success) return failure(issuesOf(withFxRules.error));

  return success(withFxRules.data);
}

/** Parses an id the caller may have taken straight from a route or a form. */
function parseId(id: unknown): UseCaseResult<Transaction['id']> {
  const parsed = transactionIdSchema.safeParse(id);
  return parsed.success
    ? success(parsed.data)
    : failure([{ path: 'id', message: 'Not a transaction id' } satisfies FieldIssue]);
}

export function makeRecordTransaction(deps: { ledger: ScopedLedgerRepository }) {
  return async function recordTransaction(input: unknown): Promise<UseCaseResult<Transaction>> {
    const validated = await validateTransactionInput(deps.ledger, input);
    if (!validated.ok) return validated;

    return success(await deps.ledger.createTransaction(validated.value));
  };
}

/**
 * An update replaces every field, so it runs the identical validation — an edit
 * that could bypass the fx rule would be a hole in the rule.
 *
 * An id that is not the caller's makes the repository throw, and that is left
 * to throw: it is not something a user corrects by editing a field, so it is
 * not a `FieldIssue`.
 */
export function makeUpdateTransaction(deps: { ledger: ScopedLedgerRepository }) {
  return async function updateTransaction(
    id: unknown,
    input: unknown,
  ): Promise<UseCaseResult<Transaction>> {
    const transactionId = parseId(id);
    if (!transactionId.ok) return transactionId;

    const validated = await validateTransactionInput(deps.ledger, input);
    if (!validated.ok) return validated;

    return success(await deps.ledger.updateTransaction(transactionId.value, validated.value));
  };
}

/** Always a soft delete: a hard one would break import idempotency (ADR 0004). */
export function makeDeleteTransaction(deps: { ledger: ScopedLedgerRepository }) {
  return async function deleteTransaction(id: unknown): Promise<UseCaseResult<void>> {
    const transactionId = parseId(id);
    if (!transactionId.ok) return transactionId;

    await deps.ledger.softDeleteTransaction(transactionId.value);
    return success(undefined);
  };
}
