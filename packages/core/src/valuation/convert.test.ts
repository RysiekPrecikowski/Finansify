import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { convertViaPln, UnknownFxRateError } from './convert';

const PLN = currency('PLN');
const EUR = currency('EUR');
const USD = currency('USD');
const CHF = currency('CHF');

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

/**
 * The display-currency switcher makes round-tripping a user-visible operation:
 * flip the total to EUR, flip it back, and the number on screen has to be the
 * number that was there before. It is **not** bit-exact and no test should
 * claim it is — `dividedBy` rounds at `precision: 40`, so multiplying back
 * leaves a residual around the 34th significant digit. Two bounds are asserted
 * because they fail for different reasons: the grosz is the promise made to the
 * user, and 1e-20 is the one that actually catches a precision regression —
 * dropping `Decimal.set({ precision: 40 })` back to the library's default 20
 * trips it long before the rounded display moves.
 */
describe('convertViaPln round-trips', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['100', '4.2871'],
    ['1234.56', '4.30'],
    ['987654.32', '3.7654'],
    ['0.01', '4.4'],
    ['7', '0.9123'],
  ];

  for (const [amount, rate] of cases) {
    for (const via of [EUR, CHF]) {
      it(`returns ${amount} PLN to the grosz through ${via} at ${rate}`, () => {
        const rates = new Map([[via, new Decimal(rate)]]);
        const start = Money.of(amount, PLN);

        const there = convertViaPln(start, via, rates);
        const back = convertViaPln(there, PLN, rates);

        expect(back.currency).toBe(PLN);
        expect(back.amount.toFixed(2)).toBe(start.amount.toFixed(2));
        expect(back.amount.minus(start.amount).abs().lessThan('1e-20')).toBe(true);
      });
    }
  }

  it('round-trips a cross pair without drifting a grosz', () => {
    const rates = new Map([
      [EUR, new Decimal('4.2871')],
      [CHF, new Decimal('4.5612')],
    ]);
    const start = Money.of('54321.99', EUR);

    const back = convertViaPln(convertViaPln(start, CHF, rates), EUR, rates);

    expect(back.amount.toFixed(2)).toBe(start.amount.toFixed(2));
    expect(back.amount.minus(start.amount).abs().lessThan('1e-20')).toBe(true);
  });
});
