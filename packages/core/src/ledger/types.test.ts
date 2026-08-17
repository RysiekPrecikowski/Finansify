import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { Temporal } from '../time';
import {
  accountId,
  accountInputSchema,
  costBasisOf,
  grossValueOf,
  instrumentId,
  netProceedsOf,
  transactionId,
  transactionInputSchema,
  transactionInputSchemaFor,
  transactionShapeOf,
  type Transaction,
} from './types';

const PLN = currency('PLN');
const USD = currency('USD');

function moneyOf(amount: string, ccy = PLN) {
  return Money.of(amount, ccy);
}

// A minimal, fully-specified transaction so each test only overrides what it's
// actually exercising — a partial builder here would hide which field a test
// depends on.
function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: transactionId('11111111-1111-4111-8111-111111111111'),
    accountId: accountId('22222222-2222-4222-8222-222222222222'),
    instrumentId: instrumentId('33333333-3333-4333-8333-333333333333'),
    type: 'buy',
    tradeDate: Temporal.PlainDate.from('2026-01-15'),
    settleDate: null,
    quantity: new Decimal('100'),
    price: null,
    grossAmount: null,
    fee: moneyOf('0'),
    tax: moneyOf('0'),
    currency: PLN,
    fxRate: null,
    fxRateSource: null,
    source: 'manual',
    externalId: null,
    importBatchId: null,
    editedAfterImport: false,
    deleted: false,
    matchedLotIds: null,
    note: null,
    ...overrides,
  };
}

describe('grossValueOf', () => {
  it('prefers grossAmount over quantity × price when both are present', () => {
    // A broker-rounded gross that deliberately disagrees with quantity × price,
    // so a wrong precedence shows up as a wrong assertion, not a coincidence.
    const t = transaction({
      quantity: new Decimal('100'),
      price: moneyOf('10.00'),
      grossAmount: moneyOf('999.99'),
    });

    expect(grossValueOf(t).equals(moneyOf('999.99'))).toBe(true);
  });

  it('falls back to quantity × price when grossAmount is absent', () => {
    const t = transaction({ quantity: new Decimal('12.5'), price: moneyOf('4.40') });

    expect(grossValueOf(t).equals(moneyOf('55.00'))).toBe(true);
  });

  it('is zero for a row with neither, such as a deposit', () => {
    const t = transaction({ type: 'deposit', instrumentId: null, quantity: new Decimal('0') });

    expect(grossValueOf(t).isZero()).toBe(true);
  });
});

describe('costBasisOf', () => {
  it('adds the fee to the gross value', () => {
    const t = transaction({ grossAmount: moneyOf('1000.00'), fee: moneyOf('9.99') });

    expect(costBasisOf(t).equals(moneyOf('1009.99'))).toBe(true);
  });

  it('excludes tax — Polish investment tax settles on realized gains, not the basis', () => {
    const t = transaction({
      grossAmount: moneyOf('1000.00'),
      fee: moneyOf('9.99'),
      tax: moneyOf('50.00'),
    });

    expect(costBasisOf(t).equals(moneyOf('1009.99'))).toBe(true);
  });
});

describe('netProceedsOf', () => {
  it('subtracts both fee and tax from the gross value', () => {
    const t = transaction({
      type: 'sell',
      grossAmount: moneyOf('1000.00'),
      fee: moneyOf('9.99'),
      tax: moneyOf('190.01'),
    });

    expect(netProceedsOf(t).equals(moneyOf('800.00'))).toBe(true);
  });
});

describe('transactionInputSchemaFor', () => {
  const baseInput = {
    accountId: '22222222-2222-4222-8222-222222222222',
    instrumentId: '33333333-3333-4333-8333-333333333333',
    type: 'buy' as const,
    tradeDate: '2026-01-15',
    quantity: '100',
    currency: 'PLN',
  };

  it('accepts a transaction in the account currency with no rate', () => {
    const result = transactionInputSchemaFor(PLN).safeParse(baseInput);

    expect(result.success).toBe(true);
  });

  // Rule 6 / ADR 0006: a broker converts at its own spread, so the rate must be
  // the one actually executed. There is no defensible default to fall back to,
  // which is exactly why this has to be a hard refusal, not a soft one.
  it('refuses a foreign-currency transaction with no executed rate', () => {
    const result = transactionInputSchemaFor(PLN).safeParse({ ...baseInput, currency: 'USD' });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('fxRate');
    expect(paths).toContain('fxRateSource');
  });

  it('accepts a foreign-currency transaction once both the rate and its source are given', () => {
    const result = transactionInputSchemaFor(PLN).safeParse({
      ...baseInput,
      currency: 'USD',
      fxRate: '4.05',
      fxRateSource: 'broker',
    });

    expect(result.success).toBe(true);
  });

  it('is case-insensitive when comparing the transaction currency to the account currency', () => {
    const result = transactionInputSchemaFor(USD).safeParse({ ...baseInput, currency: 'usd' });

    expect(result.success).toBe(true);
  });
});

describe('transactionInputSchema — positive-quantity refinement on buy/sell', () => {
  const baseInput = {
    accountId: '22222222-2222-4222-8222-222222222222',
    instrumentId: '33333333-3333-4333-8333-333333333333',
    tradeDate: '2026-01-15',
    currency: 'PLN',
  };

  it('rejects a buy with quantity 0, with the issue on `quantity`', () => {
    const result = transactionInputSchema.safeParse({ ...baseInput, type: 'buy', quantity: '0' });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('quantity');
  });

  it('rejects a sell with quantity 0, with the issue on `quantity`', () => {
    const result = transactionInputSchema.safeParse({ ...baseInput, type: 'sell', quantity: '0' });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('quantity');
  });

  it('rejects a sell with a negative quantity, with the issue on `quantity`', () => {
    const result = transactionInputSchema.safeParse({
      ...baseInput,
      type: 'sell',
      quantity: '-5',
    });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('quantity');
  });

  it('accepts a buy with a positive quantity', () => {
    const result = transactionInputSchema.safeParse({
      ...baseInput,
      type: 'buy',
      quantity: '10',
    });

    expect(result.success).toBe(true);
  });

  // `deposit`/`dividend`/etc. always carry `quantity: '0'` by convention — the
  // refinement is scoped to buy/sell only and must leave every other type alone.
  it('leaves a non-buy/sell type with quantity 0 unaffected, such as a deposit', () => {
    const result = transactionInputSchema.safeParse({
      ...baseInput,
      instrumentId: null,
      type: 'deposit',
      quantity: '0',
      grossAmount: '1000',
    });

    expect(result.success).toBe(true);
  });

  it('leaves a non-buy/sell type with quantity 0 unaffected, such as a dividend', () => {
    const result = transactionInputSchema.safeParse({
      ...baseInput,
      type: 'dividend',
      quantity: '0',
      grossAmount: '50',
    });

    expect(result.success).toBe(true);
  });

  // Both `.superRefine` calls — this schema's own and the FX-rate one
  // `transactionInputSchemaFor` layers on top — must compose: a bad quantity on
  // a foreign-currency trade with no `fxRate` should report both issues, not
  // just whichever refinement ran last swallowing the other.
  it('reports both the quantity issue and the fxRate issue when chained through transactionInputSchemaFor', () => {
    const result = transactionInputSchemaFor(PLN).safeParse({
      ...baseInput,
      type: 'sell',
      quantity: '0',
      currency: 'USD',
    });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('quantity');
    expect(paths).toContain('fxRate');
    expect(paths).toContain('fxRateSource');
  });
});

describe('transactionShapeOf', () => {
  // Exhaustive over `transactionTypes`, per the table in the ledger use-case
  // spec: which row governs what a form must collect and how a use case
  // resolves `instrumentId` and computes the amount to persist.
  const requiredUnits = [
    'buy',
    'sell',
    'transfer_in',
    'transfer_out',
    'bond_purchase',
    'bond_redemption',
    'bond_early_redemption',
    'split',
  ] as const;
  const requiredGross = ['dividend', 'coupon'] as const;
  const noneGross = ['deposit', 'withdrawal', 'fee', 'tax', 'interest'] as const;

  it.each(requiredUnits)('requires an instrument and counts units for %s', (type) => {
    expect(transactionShapeOf(type)).toEqual({ instrument: 'required', amount: 'units' });
  });

  it.each(requiredGross)('requires an instrument and counts gross amount for %s', (type) => {
    expect(transactionShapeOf(type)).toEqual({ instrument: 'required', amount: 'gross' });
  });

  it.each(noneGross)('takes no instrument and counts gross amount for %s', (type) => {
    expect(transactionShapeOf(type)).toEqual({ instrument: 'none', amount: 'gross' });
  });
});

describe('accountInputSchema currency', () => {
  const baseAccount = {
    name: 'XTB brokerage',
    broker: 'XTB',
    wrapper: 'brokerage' as const,
    openedAt: '2024-01-01',
  };

  it('upper-cases a lower-case three-letter currency code', () => {
    const result = accountInputSchema.safeParse({ ...baseAccount, currency: 'pln' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.currency).toBe('PLN');
  });

  it('rejects a currency that is not a three-letter code', () => {
    const result = accountInputSchema.safeParse({ ...baseAccount, currency: 'zloty' });

    expect(result.success).toBe(false);
  });
});
