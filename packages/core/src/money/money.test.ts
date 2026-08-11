import { describe, expect, it } from 'vitest';
import { currency } from './currency';
import { CurrencyMismatchError, Money } from './money';

const PLN = currency('PLN');
const USD = currency('USD');

describe('Money', () => {
  it('adds exactly, unlike floating point', () => {
    const a = Money.of('0.1', PLN);
    const b = Money.of('0.2', PLN);
    expect(a.plus(b).equals(Money.of('0.3', PLN))).toBe(true);
  });

  it('throws rather than silently mixing currencies', () => {
    const pln = Money.of(10, PLN);
    const usd = Money.of(10, USD);
    expect(() => pln.plus(usd)).toThrow(CurrencyMismatchError);
    expect(() => pln.minus(usd)).toThrow(CurrencyMismatchError);
    expect(() => pln.greaterThan(usd)).toThrow(CurrencyMismatchError);
  });

  it('scales by a plain factor for quantities and percentages', () => {
    const price = Money.of('19.99', PLN);
    expect(price.times(3).equals(Money.of('59.97', PLN))).toBe(true);
  });

  it('divides exactly when the result terminates', () => {
    const total = Money.of('100', PLN);
    const quarter = total.dividedBy(4);
    expect(quarter.plus(quarter).plus(quarter).plus(quarter).equals(total)).toBe(true);
  });

  it('compounds without drift over repeated addition', () => {
    let balance = Money.zero(PLN);
    for (let i = 0; i < 10; i++) {
      balance = balance.plus(Money.of('0.1', PLN));
    }
    expect(balance.equals(Money.of('1', PLN))).toBe(true);
  });

  it('treats equals as currency- and amount-sensitive, never throwing', () => {
    expect(Money.of(10, PLN).equals(Money.of(10, USD))).toBe(false);
    expect(Money.of(10, PLN).equals(Money.of('10.00', PLN))).toBe(true);
  });

  it('distinguishes strictly positive/negative from zero', () => {
    expect(Money.zero(PLN).isPositive()).toBe(false);
    expect(Money.zero(PLN).isNegative()).toBe(false);
    expect(Money.zero(PLN).isZero()).toBe(true);
    expect(Money.of('-5', PLN).isNegative()).toBe(true);
    expect(Money.of('5', PLN).isPositive()).toBe(true);
  });

  it('negates and takes absolute value', () => {
    const loss = Money.of('-42.50', PLN);
    expect(loss.negated().equals(Money.of('42.50', PLN))).toBe(true);
    expect(loss.abs().equals(Money.of('42.50', PLN))).toBe(true);
  });
});
