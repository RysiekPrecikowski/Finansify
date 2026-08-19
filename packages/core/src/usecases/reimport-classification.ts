import Decimal from 'decimal.js';

import { type Transaction, type TransactionId, type TransactionInput } from '../ledger/types';
import { currency, Money, type Currency } from '../money';
import { Temporal } from '../time';

import { CONFLICT_REASON, DELETED_REASON } from './accept-import-row';

function decimalMatches(existing: Decimal | null, value: string | null): boolean {
  if (existing === null || value === null) return existing === null && value === null;
  return existing.equals(new Decimal(value));
}

function dateMatches(existing: Temporal.PlainDate | null, value: string | null): boolean {
  if (existing === null || value === null) return existing === null && value === null;
  return existing.equals(Temporal.PlainDate.from(value));
}

function moneyMatches(
  existing: Money | null,
  amount: string | null,
  txCurrency: Currency,
): boolean {
  if (existing === null || amount === null) return existing === null && amount === null;
  return existing.equals(Money.of(amount, txCurrency));
}

/**
 * True when every field a reimport carries already matches `existing` —
 * the case a re-import of an unchanged statement hits for nearly every row,
 * and the one a blind per-row refresh writes to the database anyway. Compared
 * as `Decimal`/`Money`/`PlainDate`, never as raw strings, so "10" and "10.00"
 * count as the same quantity.
 */
export function transactionUnchanged(existing: Transaction, input: TransactionInput): boolean {
  const txCurrency = currency(input.currency);

  return (
    existing.instrumentId === input.instrumentId &&
    existing.type === input.type &&
    dateMatches(existing.tradeDate, input.tradeDate) &&
    dateMatches(existing.settleDate, input.settleDate) &&
    existing.quantity.equals(new Decimal(input.quantity)) &&
    moneyMatches(existing.price, input.price, txCurrency) &&
    moneyMatches(existing.grossAmount, input.grossAmount, txCurrency) &&
    existing.fee.equals(Money.of(input.fee, txCurrency)) &&
    existing.tax.equals(Money.of(input.tax, txCurrency)) &&
    existing.currency === txCurrency &&
    decimalMatches(existing.fxRate, input.fxRate) &&
    existing.fxRateSource === input.fxRateSource &&
    existing.note === input.note
  );
}

export type ReimportClassification =
  | { readonly kind: 'new' }
  | { readonly kind: 'unchanged'; readonly existingId: TransactionId }
  | { readonly kind: 'changed'; readonly existingId: TransactionId }
  | { readonly kind: 'conflict'; readonly existingId: TransactionId; readonly reason: string }
  | { readonly kind: 'deleted'; readonly existingId: TransactionId; readonly reason: string };

/**
 * The branch `acceptImportRow`'s own doc comment describes, factored out so
 * `acceptImportRows` (batched accept) and `detectImportDuplicates` (read-only
 * preview) classify a reimported row identically instead of drifting apart.
 *
 * Order matters: `deleted` and `editedAfterImport` are provenance flags, not a
 * content comparison — checked first and unconditionally, so a hand-edited or
 * deleted row is never reported as merely `changed`/`unchanged` even when its
 * current values happen to coincide with the reimport.
 */
export function classifyReimport(
  existing: Transaction | null,
  input: TransactionInput,
): ReimportClassification {
  if (existing === null) return { kind: 'new' };
  if (existing.deleted) return { kind: 'deleted', existingId: existing.id, reason: DELETED_REASON };
  if (existing.editedAfterImport) {
    return { kind: 'conflict', existingId: existing.id, reason: CONFLICT_REASON };
  }
  return transactionUnchanged(existing, input)
    ? { kind: 'unchanged', existingId: existing.id }
    : { kind: 'changed', existingId: existing.id };
}
