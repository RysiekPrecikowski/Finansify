import { describe, expect, it } from 'vitest';

import {
  calculateCashBalance,
  calculateCashBalanceAt,
  calculateTransactionAmountInAccountCurrency,
  sumTransactionAmountsInAccountCurrency,
  type LedgerTransaction,
  type TimedLedgerTransaction,
} from './ledger';
import { Decimal } from './money';

const plnDeposit: LedgerTransaction = {
  type: 'DEPOSIT',
  amount: new Decimal('100'),
  currency: 'PLN',
  accountCurrency: 'PLN',
  fxRateToAccountCurrency: new Decimal('1'),
};

describe('calculateTransactionAmountInAccountCurrency', () => {
  it('signs the amount by transaction type', () => {
    expect(calculateTransactionAmountInAccountCurrency(plnDeposit).toString()).toBe('100');
    expect(
      calculateTransactionAmountInAccountCurrency({ ...plnDeposit, type: 'BUY' }).toString(),
    ).toBe('-100');
  });

  it('rejects a non-positive FX rate instead of producing a nonsense balance', () => {
    expect(() =>
      calculateTransactionAmountInAccountCurrency({
        ...plnDeposit,
        fxRateToAccountCurrency: new Decimal('0'),
      }),
    ).toThrow('fxRateToAccountCurrency must be greater than zero');
  });
});

describe('cash balance', () => {
  const transactions: LedgerTransaction[] = [
    { ...plnDeposit, amount: new Decimal('1000') },
    {
      type: 'BUY',
      amount: new Decimal('100'),
      currency: 'USD',
      accountCurrency: 'PLN',
      fxRateToAccountCurrency: new Decimal('4'),
    },
    {
      type: 'SELL',
      amount: new Decimal('50'),
      currency: 'USD',
      accountCurrency: 'PLN',
      fxRateToAccountCurrency: new Decimal('4'),
    },
    { ...plnDeposit, type: 'WITHDRAW', amount: new Decimal('80') },
  ];

  it('sums multi-currency movements into the account currency', () => {
    expect(sumTransactionAmountsInAccountCurrency(transactions).toString()).toBe('720');
  });

  it('adds the opening balance', () => {
    expect(calculateCashBalance(transactions, new Decimal('100')).toString()).toBe('820');
  });

  it('defaults the opening balance to zero', () => {
    expect(calculateCashBalance([]).toString()).toBe('0');
  });
});

describe('calculateCashBalanceAt', () => {
  const transactions: TimedLedgerTransaction[] = [
    { ...plnDeposit, amount: new Decimal('1000'), occurredAt: '2026-01-01T10:00:00.000Z' },
    {
      type: 'BUY',
      amount: new Decimal('100'),
      currency: 'USD',
      accountCurrency: 'PLN',
      fxRateToAccountCurrency: new Decimal('4'),
      occurredAt: '2026-01-03T10:00:00.000Z',
    },
    {
      type: 'SELL',
      amount: new Decimal('50'),
      currency: 'USD',
      accountCurrency: 'PLN',
      fxRateToAccountCurrency: new Decimal('4'),
      occurredAt: '2026-01-05T10:00:00.000Z',
    },
  ];

  it.each([
    ['2026-01-02T00:00:00.000Z', '1100'],
    ['2026-01-04T00:00:00.000Z', '700'],
    ['2026-01-06T00:00:00.000Z', '900'],
  ])('reconstructs the balance as of %s', (asOf, expected) => {
    expect(calculateCashBalanceAt(transactions, asOf, new Decimal('100')).toString()).toBe(
      expected,
    );
  });
});
