import { transactionShapeOf, transactionTypes, type TransactionType } from '@finansify/core';

import { normalizeDecimalInput } from './decimal-input';

function isTransactionType(value: string | null): value is TransactionType {
  return value !== null && (transactionTypes as readonly string[]).includes(value);
}

/**
 * A submitted form becomes the object `transactionInputSchema` expects.
 *
 * The whole difficulty is that "empty" does not mean one thing. Three different
 * answers are correct depending on the field, and picking the wrong one fails
 * in a way that looks like a schema bug:
 *
 * - **`null`** for the nullable columns. A blank settle date is genuinely no
 *   settle date.
 * - **omitted** for `fee` and `tax`. `z.default()` fires on `undefined` and on
 *   nothing else, so `fee: null` is a validation error rather than a zero. This
 *   is the trap: mapping every empty field to `null` is the obvious thing to
 *   write and it is wrong.
 * - **`'0'`** for `quantity` on a gross-shaped row, which has no unit leg at
 *   all — `quantity` is the one decimal that is not nullable. On a units-shaped
 *   row a blank quantity is passed through instead, so the schema refuses it.
 *   Inventing a zero there would silently book a buy of nothing.
 *
 * Nothing here anticipates rule 6. `fxRate` is carried exactly as submitted,
 * because only `transactionInputSchemaFor(accountCurrency)` knows what the
 * account is denominated in, and a rate invented at this layer would be the
 * precise failure ADR 0006 exists to prevent.
 */
export function transactionInputFrom(formData: FormData): Record<string, unknown> {
  /** `FormData.get` is `string | File | null`; a File is treated as absent. */
  const text = (name: string): string | null => {
    const raw = formData.get(name);
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  };

  const amount = (name: string): string | null => {
    const raw = text(name);
    return raw === null ? null : normalizeDecimalInput(raw);
  };

  const type = text('type');
  const shape = isTransactionType(type) ? transactionShapeOf(type) : null;

  // An unrecognized type leaves the shape unknown, so the quantity is passed
  // through untouched and `z.enum` reports the real problem — the type — rather
  // than this mapper masking it with an invented zero.
  const quantity = amount('quantity') ?? (shape?.amount === 'gross' ? '0' : text('quantity'));

  const fee = amount('fee');
  const tax = amount('tax');

  return {
    accountId: text('accountId'),
    instrumentId: text('instrumentId'),
    type,
    tradeDate: text('tradeDate'),
    settleDate: text('settleDate'),
    quantity,
    price: amount('price'),
    grossAmount: amount('grossAmount'),
    // Spread rather than assigned: the key must be absent, not `undefined`.
    ...(fee === null ? {} : { fee }),
    ...(tax === null ? {} : { tax }),
    currency: text('currency'),
    fxRate: amount('fxRate'),
    fxRateSource: text('fxRateSource'),
    note: text('note'),
  };
}
