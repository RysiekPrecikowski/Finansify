import {
  DECIMAL_ONE,
  toDecimal,
  type CurrencyCode,
  type Decimal,
  type DecimalInput,
} from './money';
import { findLatestAtOrBefore } from './time';

/** A rate map keyed by `FROM_TO`, e.g. `USD_PLN`. Used for point-in-time conversion. */
export type FxRates = Record<string, Decimal>;

/** A dated FX observation. Persisted immutably; never updated in place. */
export interface FxRatePoint {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: Decimal;
  observedAt: string;
}

export function createFxPairKey(from: CurrencyCode, to: CurrencyCode): string {
  return `${from}_${to}`;
}

export function getFxRate(from: CurrencyCode, to: CurrencyCode, rates: FxRates): Decimal {
  if (from === to) {
    return DECIMAL_ONE;
  }

  const directRate = rates[createFxPairKey(from, to)];
  if (directRate !== undefined) {
    return directRate;
  }

  const inverseRate = rates[createFxPairKey(to, from)];
  if (inverseRate !== undefined) {
    return DECIMAL_ONE.div(inverseRate);
  }

  throw new Error(`Missing FX rate for ${from} -> ${to}`);
}

export function convertCurrency(
  amount: DecimalInput,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: FxRates,
): Decimal {
  return toDecimal(amount).mul(getFxRate(from, to, rates));
}

/**
 * Nearest-prior-observation lookup, falling back to the inverse pair.
 *
 * Throws rather than guessing when no prior observation exists: a missing rate is
 * a visible gap in the UI, not a silently-estimated number. See docs/domain.md.
 */
export function getFxRateAtOrBefore(
  from: CurrencyCode,
  to: CurrencyCode,
  points: readonly FxRatePoint[],
  asOf: string,
): Decimal {
  if (from === to) {
    return DECIMAL_ONE;
  }

  const direct = findLatestAtOrBefore(
    points,
    asOf,
    (point) => point.observedAt,
    (point) => point.fromCurrency === from && point.toCurrency === to,
  );

  if (direct) {
    return direct.rate;
  }

  const inverse = findLatestAtOrBefore(
    points,
    asOf,
    (point) => point.observedAt,
    (point) => point.fromCurrency === to && point.toCurrency === from,
  );

  if (inverse) {
    return DECIMAL_ONE.div(inverse.rate);
  }

  throw new Error(`Missing FX rate point for ${from} -> ${to} at ${asOf}`);
}
