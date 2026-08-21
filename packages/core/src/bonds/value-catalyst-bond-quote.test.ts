import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { valueCatalystBondQuote } from './value-catalyst-bond-quote';

const PLN = currency('PLN');
const EUR = currency('EUR');

describe('valueCatalystBondQuote', () => {
  it('turns a quote (money per 100 nominal) into money per one bond', () => {
    const quote = Money.of('78.5', PLN);
    const nominal = Money.of('100', PLN);

    const value = valueCatalystBondQuote(quote, nominal);

    expect(value.currency).toBe(PLN);
    expect(value.amount.toFixed(2)).toBe('78.50');
  });

  it('scales correctly for a nominal other than 100', () => {
    // A 1000 PLN nominal bond quoted at 78.5 (per 100) is worth 785 PLN.
    const quote = Money.of('78.5', PLN);
    const nominal = Money.of('1000', PLN);

    const value = valueCatalystBondQuote(quote, nominal);

    expect(value.amount.toFixed(2)).toBe('785.00');
  });

  it('is exact, not rounded, for a quote with more decimals', () => {
    const quote = Money.of('99.999', PLN);
    const nominal = Money.of('100', PLN);

    const value = valueCatalystBondQuote(quote, nominal);

    expect(value.amount.toFixed(3)).toBe('99.999');
  });

  it('refuses a quote and nominal in different currencies rather than silently mixing them', () => {
    const quote = Money.of('78.5', EUR);
    const nominal = Money.of('100', PLN);

    expect(() => valueCatalystBondQuote(quote, nominal)).toThrow();
  });
});
