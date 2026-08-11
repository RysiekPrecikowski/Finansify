import Decimal from 'decimal.js';
import { type Currency } from './currency';

export class CurrencyMismatchError extends Error {
  constructor(operation: string, a: Currency, b: Currency) {
    super(`Cannot ${operation} ${a} and ${b} — mixing currencies is not allowed`);
    this.name = 'CurrencyMismatchError';
  }
}

export class Money {
  readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount;
    this.currency = currency;
  }

  static of(amount: Decimal.Value, currency: Currency): Money {
    return new Money(new Decimal(amount), currency);
  }

  static zero(currency: Currency): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(operation: string, other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(operation, this.currency, other.currency);
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency('add', other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency('subtract', other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  times(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  dividedBy(divisor: Decimal.Value): Money {
    return new Money(this.amount.dividedBy(divisor), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency('compare', other);
    return this.amount.greaterThan(other.amount);
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency('compare', other);
    return this.amount.lessThan(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  // Decimal.isPositive() treats zero as positive; Money's callers mean "> 0".
  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  toString(): string {
    return `${this.amount.toFixed()} ${this.currency}`;
  }
}
