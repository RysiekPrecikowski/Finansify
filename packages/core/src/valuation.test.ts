import { describe, expect, it } from 'vitest';

import { type FxRatePoint, type FxRates } from './fx';
import { Decimal } from './money';
import {
  calculateNetWorth,
  calculatePortfolioMarketValue,
  calculatePortfolioMarketValueAt,
  type PositionMarketInput,
  type PositionQuantity,
  type PricePoint,
} from './valuation';

describe('calculatePortfolioMarketValue', () => {
  it('converts each position into the display currency before summing', () => {
    const positions: PositionMarketInput[] = [
      {
        instrumentId: 'AAPL',
        quantity: new Decimal('2'),
        marketPrice: new Decimal('100'),
        priceCurrency: 'USD',
      },
      {
        instrumentId: 'VWCE',
        quantity: new Decimal('1'),
        marketPrice: new Decimal('50'),
        priceCurrency: 'EUR',
      },
    ];

    const rates: FxRates = { USD_PLN: new Decimal('4'), EUR_PLN: new Decimal('4.5') };

    // 2 * 100 * 4 + 1 * 50 * 4.5
    expect(calculatePortfolioMarketValue(positions, 'PLN', rates).toString()).toBe('1025');
  });

  it('is zero for an empty portfolio', () => {
    expect(calculatePortfolioMarketValue([], 'PLN', {}).toString()).toBe('0');
  });
});

describe('calculatePortfolioMarketValueAt', () => {
  const positions: PositionQuantity[] = [
    { instrumentId: 'AAPL', quantity: new Decimal('2') },
    { instrumentId: 'VWCE', quantity: new Decimal('1') },
  ];

  const pricePoints: PricePoint[] = [
    {
      instrumentId: 'AAPL',
      marketPrice: new Decimal('100'),
      priceCurrency: 'USD',
      observedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      instrumentId: 'AAPL',
      marketPrice: new Decimal('120'),
      priceCurrency: 'USD',
      observedAt: '2026-01-04T00:00:00.000Z',
    },
    {
      instrumentId: 'VWCE',
      marketPrice: new Decimal('50'),
      priceCurrency: 'EUR',
      observedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      instrumentId: 'VWCE',
      marketPrice: new Decimal('55'),
      priceCurrency: 'EUR',
      observedAt: '2026-01-05T00:00:00.000Z',
    },
  ];

  const fxRatePoints: FxRatePoint[] = [
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
    {
      fromCurrency: 'EUR',
      toCurrency: 'PLN',
      rate: new Decimal('4.5'),
      observedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      fromCurrency: 'EUR',
      toCurrency: 'PLN',
      rate: new Decimal('4.6'),
      observedAt: '2026-01-04T00:00:00.000Z',
    },
  ];

  it('values using the nearest prior price and FX for each position', () => {
    // 2 * 100 * 4 + 1 * 50 * 4.5
    expect(
      calculatePortfolioMarketValueAt(
        positions,
        pricePoints,
        'PLN',
        fxRatePoints,
        '2026-01-02T12:00:00.000Z',
      ).toString(),
    ).toBe('1025');

    // 2 * 120 * 4.1 + 1 * 55 * 4.6
    expect(
      calculatePortfolioMarketValueAt(
        positions,
        pricePoints,
        'PLN',
        fxRatePoints,
        '2026-01-05T12:00:00.000Z',
      ).toString(),
    ).toBe('1237');
  });

  it('surfaces a price gap instead of extrapolating backwards', () => {
    expect(() =>
      calculatePortfolioMarketValueAt(
        positions,
        pricePoints,
        'PLN',
        fxRatePoints,
        '2025-12-31T00:00:00.000Z',
      ),
    ).toThrow(/Missing price point for AAPL/);
  });
});

describe('calculateNetWorth', () => {
  it('adds cash to portfolio value', () => {
    expect(calculateNetWorth('1200', '3800').toString()).toBe('5000');
  });
});
