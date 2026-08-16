import Decimal from 'decimal.js';

import { Money } from '../money';
import { type WithheldAmount } from './types';

/**
 * Polish flat-rate capital gains tax ("podatek Belki"). A default, not a
 * constant the engine may assume: IKE and IKZE are exempt, and the rate is a
 * property of the *account's wrapper*, not of the bond.
 *
 * This is why withholding lives here rather than inside `accrueBond`. A bond
 * held in a brokerage account and the identical bond held in an IKE accrue
 * exactly the same interest and pay different tax — folding the rate into the
 * accrual would make the engine wrong for one of them, silently.
 */
export const BELKA_RATE = new Decimal('0.19');

/**
 * Split a gross interest amount into tax and net.
 *
 * Rounded **half-up to the grosz**, matching how the tax is actually withheld
 * at source, and computed on the gross rather than derived by subtraction so
 * that `tax + net === gross` holds exactly rather than approximately.
 */
export function withholdingOn(gross: Money, rate: Decimal = BELKA_RATE): WithheldAmount {
  if (rate.isNegative() || rate.greaterThan(1)) {
    throw new Error(`A withholding rate of ${rate.toFixed()} is not a rate`);
  }
  if (!gross.isPositive()) {
    return { gross, tax: Money.zero(gross.currency), net: gross };
  }

  const tax = Money.of(
    gross.amount.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    gross.currency,
  );
  return { gross, tax, net: gross.minus(tax) };
}
