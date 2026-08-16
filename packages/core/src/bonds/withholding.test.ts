import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { BELKA_RATE, withholdingOn } from './withholding';

const PLN = currency('PLN');
const pln = (amount: string) => Money.of(amount, PLN);

describe('withholdingOn', () => {
  it('withholds 19% by default', () => {
    const result = withholdingOn(pln('100.00'));

    expect(BELKA_RATE.toFixed(2)).toBe('0.19');
    expect(result.tax).toEqual(pln('19.00'));
    expect(result.net).toEqual(pln('81.00'));
  });

  it('rounds the tax half-up to the grosz', () => {
    // 5.35 × 0.19 = 1.0165 → 1.02
    expect(withholdingOn(pln('5.35')).tax).toEqual(pln('1.02'));
  });

  it('keeps tax and net summing exactly back to gross', () => {
    for (const gross of ['0.01', '5.35', '10.09', '1053.50', '99999.99']) {
      const result = withholdingOn(pln(gross));
      expect(result.tax.plus(result.net)).toEqual(pln(gross));
    }
  });

  it('takes an exempt rate, because IKE and IKZE pay nothing', () => {
    const result = withholdingOn(pln('1053.50'), new Decimal(0));

    expect(result.tax).toEqual(pln('0.00'));
    expect(result.net).toEqual(pln('1053.50'));
  });

  it('leaves a zero or negative amount alone rather than inventing a refund', () => {
    expect(withholdingOn(pln('0.00')).tax).toEqual(pln('0.00'));
    expect(withholdingOn(pln('-4.00')).net).toEqual(pln('-4.00'));
  });

  it('refuses a rate that is not a rate', () => {
    expect(() => withholdingOn(pln('100.00'), new Decimal('-0.1'))).toThrow();
    expect(() => withholdingOn(pln('100.00'), new Decimal('1.5'))).toThrow();
  });
});
