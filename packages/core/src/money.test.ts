import { describe, expect, it } from 'vitest';

import { createMoney, isSameCurrency, toDecimal } from './money';

describe('toDecimal', () => {
  it('keeps exact decimal arithmetic where JS numbers would drift', () => {
    expect(toDecimal('0.1').plus('0.2').toString()).toBe('0.3');
    expect(toDecimal('0.1').mul('0.1').toString()).toBe('0.01');
  });

  it('passes an existing Decimal through unchanged', () => {
    const value = toDecimal('42');

    expect(toDecimal(value)).toBe(value);
  });
});

describe('createMoney', () => {
  it('pairs an amount with its currency', () => {
    const money = createMoney('99.99', 'PLN');

    expect(money.amount.toString()).toBe('99.99');
    expect(money.currency).toBe('PLN');
  });

  it('compares currencies', () => {
    expect(isSameCurrency(createMoney('1', 'PLN'), createMoney('2', 'PLN'))).toBe(true);
    expect(isSameCurrency(createMoney('1', 'PLN'), createMoney('2', 'USD'))).toBe(false);
  });
});
