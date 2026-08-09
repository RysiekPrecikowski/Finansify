import Decimal from 'decimal.js';

// 28 significant digits: enough headroom that repeated FX + fee arithmetic
// never surfaces rounding in a displayed value. Rounding happens at render, never here.
Decimal.set({ precision: 28 });

export { Decimal };

/**
 * Money is always constructed from a string or a Decimal -- never a JS number.
 * `0.1 + 0.2 !== 0.3` in binary floating point, and this is an accounting system.
 */
export type DecimalInput = Decimal | string;

export const DECIMAL_ZERO = new Decimal('0');
export const DECIMAL_ONE = new Decimal('1');

export function toDecimal(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export const CURRENCY_CODES = ['PLN', 'USD', 'EUR', 'GBP', 'CHF'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface Money {
  amount: Decimal;
  currency: CurrencyCode;
}

export function createMoney(amount: DecimalInput, currency: CurrencyCode): Money {
  return { amount: toDecimal(amount), currency };
}

export function isSameCurrency(left: Money, right: Money): boolean {
  return left.currency === right.currency;
}
