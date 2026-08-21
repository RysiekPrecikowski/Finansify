import { CurrencyMismatchError, type Money } from '../money';

/**
 * A Catalyst quote is money, not a bare percentage — GPW's `chart-json.php`
 * bar is the price the market pays per 100 units of nominal, in the bond's
 * own currency (verified live: PLGHLMC00602 traded at 78.5, and the same
 * series was independently reported at 59.99% of nominal months earlier —
 * same unit, same scale). Turning that into a market value per bond is
 * exactly the arithmetic a bond price convention always implies: `quote ×
 * (nominal / 100)`. `PriceBar.close: Money` needed nothing new — ADR 0022's
 * "nowhere to put percent-of-nominal" framing was the wrong diagnosis; the
 * missing piece was always this formula plus a source for `nominal`, not a
 * new representation (ADR 0023).
 */
export function valueCatalystBondQuote(quote: Money, nominal: Money): Money {
  if (quote.currency !== nominal.currency) {
    throw new CurrencyMismatchError(
      'value a Catalyst bond quote against',
      quote.currency,
      nominal.currency,
    );
  }
  return quote.times(nominal.amount).dividedBy(100);
}
