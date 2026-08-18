import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { accountId, instrumentId, transactionId, type Transaction } from '../ledger/types';
import { currency, Money } from '../money';
import { Temporal } from '../time';

import { CONFLICT_REASON, DELETED_REASON } from './accept-import-row';
import { classifyReimport, transactionUnchanged } from './reimport-classification';

const ACCOUNT = accountId('11111111-1111-4111-8111-111111111111');
const INSTRUMENT = instrumentId('22222222-2222-4222-8222-222222222222');
const TRANSACTION = transactionId('33333333-3333-4333-8333-333333333333');
const PLN = currency('PLN');

function existingTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: TRANSACTION,
    accountId: ACCOUNT,
    instrumentId: INSTRUMENT,
    type: 'buy',
    tradeDate: Temporal.PlainDate.from('2024-01-10'),
    settleDate: Temporal.PlainDate.from('2024-01-12'),
    quantity: new Decimal('10'),
    price: Money.of('100', PLN),
    grossAmount: Money.of('1000', PLN),
    fee: Money.of('5', PLN),
    tax: Money.of('0', PLN),
    currency: PLN,
    fxRate: null,
    fxRateSource: null,
    source: 'import',
    externalId: 'row-1',
    importBatchId: 'batch-1',
    editedAfterImport: false,
    deleted: false,
    matchedLotIds: null,
    note: null,
    ...overrides,
  };
}

/** Same values `existingTransaction()` carries, restated as the raw `TransactionInput` a reimport would produce. */
function matchingInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT,
    instrumentId: INSTRUMENT,
    type: 'buy' as const,
    tradeDate: '2024-01-10',
    settleDate: '2024-01-12',
    quantity: '10',
    price: '100',
    grossAmount: '1000',
    fee: '5',
    tax: '0',
    currency: 'PLN',
    fxRate: null,
    fxRateSource: null,
    note: null,
    ...overrides,
  };
}

describe('transactionUnchanged', () => {
  it('is true when every field the input carries restates the existing transaction', () => {
    expect(transactionUnchanged(existingTransaction(), matchingInput())).toBe(true);
  });

  it('tolerates a decimal restated with different trailing zeros', () => {
    expect(
      transactionUnchanged(
        existingTransaction({ quantity: new Decimal('10') }),
        matchingInput({ quantity: '10.00' }),
      ),
    ).toBe(true);
  });

  it('is false when the amount actually differs', () => {
    expect(
      transactionUnchanged(existingTransaction(), matchingInput({ grossAmount: '1250' })),
    ).toBe(false);
  });

  it('is false when the trade date differs', () => {
    expect(
      transactionUnchanged(existingTransaction(), matchingInput({ tradeDate: '2024-01-11' })),
    ).toBe(false);
  });

  it('treats a null settleDate on both sides as equal, not as a mismatch', () => {
    expect(
      transactionUnchanged(
        existingTransaction({ settleDate: null }),
        matchingInput({ settleDate: null }),
      ),
    ).toBe(true);
  });

  it('is false when settleDate is null on only one side', () => {
    expect(
      transactionUnchanged(
        existingTransaction({ settleDate: null }),
        matchingInput({ settleDate: '2024-01-12' }),
      ),
    ).toBe(false);
  });

  it('is false when price flips from a value to null', () => {
    expect(transactionUnchanged(existingTransaction(), matchingInput({ price: null }))).toBe(false);
  });

  it('compares fxRate as a decimal, tolerant of formatting', () => {
    expect(
      transactionUnchanged(
        existingTransaction({ fxRate: new Decimal('4.3') }),
        matchingInput({ fxRate: '4.30' }),
      ),
    ).toBe(true);
    expect(
      transactionUnchanged(
        existingTransaction({ fxRate: new Decimal('4.3') }),
        matchingInput({ fxRate: '4.31' }),
      ),
    ).toBe(false);
  });

  it('is false when the note differs', () => {
    expect(
      transactionUnchanged(existingTransaction({ note: 'a' }), matchingInput({ note: 'b' })),
    ).toBe(false);
  });
});

describe('classifyReimport', () => {
  it('classifies as new when there is no existing transaction', () => {
    expect(classifyReimport(null, matchingInput())).toEqual({ kind: 'new' });
  });

  it('classifies as unchanged when the match is unedited and identical', () => {
    expect(classifyReimport(existingTransaction(), matchingInput())).toEqual({
      kind: 'unchanged',
      existingId: TRANSACTION,
    });
  });

  it('classifies as changed when the match is unedited but the data differs', () => {
    expect(classifyReimport(existingTransaction(), matchingInput({ grossAmount: '1250' }))).toEqual(
      { kind: 'changed', existingId: TRANSACTION },
    );
  });

  it('classifies as conflict when the match was hand-edited, even if values still happen to match', () => {
    expect(
      classifyReimport(existingTransaction({ editedAfterImport: true }), matchingInput()),
    ).toEqual({ kind: 'conflict', existingId: TRANSACTION, reason: CONFLICT_REASON });
  });

  it('classifies as deleted when the match is soft-deleted, even if it was never hand-edited', () => {
    expect(
      classifyReimport(existingTransaction({ deleted: true }), matchingInput({ grossAmount: '1' })),
    ).toEqual({ kind: 'deleted', existingId: TRANSACTION, reason: DELETED_REASON });
  });

  it('prefers deleted over conflict when both flags are set', () => {
    expect(
      classifyReimport(
        existingTransaction({ deleted: true, editedAfterImport: true }),
        matchingInput(),
      ),
    ).toEqual({ kind: 'deleted', existingId: TRANSACTION, reason: DELETED_REASON });
  });
});
