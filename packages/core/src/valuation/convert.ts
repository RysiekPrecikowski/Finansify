import Decimal from 'decimal.js';

import { currency, Money, type Currency } from '../money';

export class UnknownFxRateError extends Error {
  constructor(code: Currency) {
    super(`No FX rate on file for ${code}`);
    this.name = 'UnknownFxRateError';
  }
}

const PLN = currency('PLN');

/**
 * Converts `amount` to `toCurrency` using mid rates *to PLN* (what
 * `fx_rates` stores — section 07). Cross pairs are never stored, only
 * computed here: `EUR → USD` goes `EUR → PLN → USD`, at the cost of one extra
 * multiplication and no extra row.
 *
 * This is the **current** rate, used for today's market value — never confuse
 * it with a transaction's stored `fxRate`, which is the rate as executed and
 * must never be reconstructed (rule 6, ADR 0006). The two answer different
 * questions and neither substitutes for the other.
 */
export function convertViaPln(
  amount: Money,
  toCurrency: Currency,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
): Money {
  if (amount.currency === toCurrency) return amount;

  const rateToPlnOf = (code: Currency): Decimal => {
    if (code === PLN) return new Decimal(1);
    const rate = ratesToPln.get(code);
    if (rate === undefined) throw new UnknownFxRateError(code);
    return rate;
  };

  const inPln = amount.amount.times(rateToPlnOf(amount.currency));
  const converted = toCurrency === PLN ? inPln : inPln.dividedBy(rateToPlnOf(toCurrency));
  return Money.of(converted, toCurrency);
}
