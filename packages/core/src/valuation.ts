import {
  convertCurrency,
  createFxPairKey,
  getFxRateAtOrBefore,
  type FxRatePoint,
  type FxRates,
} from './fx';
import {
  DECIMAL_ZERO,
  toDecimal,
  type CurrencyCode,
  type Decimal,
  type DecimalInput,
} from './money';
import { findLatestAtOrBefore } from './time';

export interface PositionQuantity {
  instrumentId: string;
  quantity: Decimal;
}

export interface PositionMarketInput extends PositionQuantity {
  marketPrice: Decimal;
  priceCurrency: CurrencyCode;
}

/** A dated price observation. Persisted immutably; never updated in place. */
export interface PricePoint {
  instrumentId: string;
  marketPrice: Decimal;
  priceCurrency: CurrencyCode;
  observedAt: string;
}

export function calculatePortfolioMarketValue(
  positions: readonly PositionMarketInput[],
  displayCurrency: CurrencyCode,
  rates: FxRates,
): Decimal {
  return positions.reduce((sum, position) => {
    const valueInPriceCurrency = position.quantity.mul(position.marketPrice);

    return sum.plus(
      convertCurrency(valueInPriceCurrency, position.priceCurrency, displayCurrency, rates),
    );
  }, DECIMAL_ZERO);
}

/**
 * Point-in-time valuation using the nearest prior price and FX observation
 * for each position. Throws on a genuine gap rather than extrapolating.
 */
export function calculatePortfolioMarketValueAt(
  positions: readonly PositionQuantity[],
  pricePoints: readonly PricePoint[],
  displayCurrency: CurrencyCode,
  fxRatePoints: readonly FxRatePoint[],
  asOf: string,
): Decimal {
  return positions.reduce((sum, position) => {
    const price = findLatestAtOrBefore(
      pricePoints,
      asOf,
      (point) => point.observedAt,
      (point) => point.instrumentId === position.instrumentId,
    );

    if (!price) {
      throw new Error(`Missing price point for ${position.instrumentId} at ${asOf}`);
    }

    const rate = getFxRateAtOrBefore(price.priceCurrency, displayCurrency, fxRatePoints, asOf);

    const value = convertCurrency(
      position.quantity.mul(price.marketPrice),
      price.priceCurrency,
      displayCurrency,
      { [createFxPairKey(price.priceCurrency, displayCurrency)]: rate },
    );

    return sum.plus(value);
  }, DECIMAL_ZERO);
}

export function calculateNetWorth(
  cashBalance: DecimalInput,
  portfolioValue: DecimalInput,
): Decimal {
  return toDecimal(cashBalance).plus(toDecimal(portfolioValue));
}
