import { describe, expect, it } from 'vitest';

import {
  convertCurrency,
  getFxRate,
  getFxRateAtOrBefore,
  type FxRatePoint,
  type FxRates,
} from './fx';
import { Decimal } from './money';

describe('getFxRate', () => {
  it('returns the direct rate when available', () => {
    const rates: FxRates = { USD_PLN: new Decimal('4') };

    expect(getFxRate('USD', 'PLN', rates).toString()).toBe('4');
  });

  it('inverts the rate when only the inverse pair is known', () => {
    const rates: FxRates = { PLN_USD: new Decimal('0.25') };

    expect(getFxRate('USD', 'PLN', rates).toString()).toBe('4');
  });

  it('returns 1 for a same-currency conversion', () => {
    expect(getFxRate('PLN', 'PLN', {}).toString()).toBe('1');
  });

  it('throws rather than guessing when the pair is unknown', () => {
    expect(() => getFxRate('USD', 'PLN', {})).toThrow('Missing FX rate for USD -> PLN');
  });
});

describe('convertCurrency', () => {
  it('converts using the FX map', () => {
    const rates: FxRates = { EUR_PLN: new Decimal('4.5') };

    expect(convertCurrency('10', 'EUR', 'PLN', rates).toString()).toBe('45');
  });

  it('does not lose precision the way binary floating point would', () => {
    const rates: FxRates = { USD_PLN: new Decimal('0.1') };

    // 0.1 * 0.1 === 0.010000000000000002 as a JS number.
    expect(convertCurrency('0.1', 'USD', 'PLN', rates).toString()).toBe('0.01');
  });
});

describe('getFxRateAtOrBefore', () => {
  const points: FxRatePoint[] = [
    {
      fromCurrency: 'USD',
      toCurrency: 'PLN',
      rate: new Decimal('4'),
      observedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      fromCurrency: 'USD',
      toCurrency: 'PLN',
      rate: new Decimal('4.1'),
      observedAt: '2026-01-03T00:00:00.000Z',
    },
  ];

  it('uses the nearest prior observation, not the nearest overall', () => {
    expect(getFxRateAtOrBefore('USD', 'PLN', points, '2026-01-02T12:00:00.000Z').toString()).toBe(
      '4',
    );
    expect(getFxRateAtOrBefore('USD', 'PLN', points, '2026-01-09T00:00:00.000Z').toString()).toBe(
      '4.1',
    );
  });

  it('throws when asked for a date before any observation exists', () => {
    expect(() => getFxRateAtOrBefore('USD', 'PLN', points, '2025-12-31T00:00:00.000Z')).toThrow(
      /Missing FX rate point/,
    );
  });
});
