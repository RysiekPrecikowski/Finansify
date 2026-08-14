import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { convertViaPln, UnknownFxRateError } from './convert';

const PLN = currency('PLN');
const EUR = currency('EUR');
const USD = currency('USD');

describe('convertViaPln', () => {
  it('returns the amount unchanged when already in the target currency', () => {
    const amount = Money.of('100', EUR);
    expect(convertViaPln(amount, EUR, new Map()).equals(amount)).toBe(true);
  });

  it('converts PLN to a foreign currency by dividing by its rate', () => {
    const rates = new Map([[USD, new Decimal('4')]]);
    const result = convertViaPln(Money.of('400', PLN), USD, rates);
    expect(result.equals(Money.of('100', USD))).toBe(true);
  });

  it('converts a foreign currency to PLN by multiplying by its rate', () => {
    const rates = new Map([[USD, new Decimal('4')]]);
    const result = convertViaPln(Money.of('100', USD), PLN, rates);
    expect(result.equals(Money.of('400', PLN))).toBe(true);
  });

  it('crosses two foreign currencies through PLN without storing the pair', () => {
    const rates = new Map([
      [EUR, new Decimal('4.30')],
      [USD, new Decimal('4.30')],
    ]);
    const result = convertViaPln(Money.of('100', EUR), USD, rates);
    expect(result.equals(Money.of('100', USD))).toBe(true);
  });

  it('throws rather than inventing a rate that was never fetched', () => {
    expect(() => convertViaPln(Money.of('100', EUR), USD, new Map())).toThrow(UnknownFxRateError);
  });
});
