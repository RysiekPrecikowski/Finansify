import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { inferFxRatios, type TradeObservation } from './fx-inference';

/**
 * Fixing `quantity` and `price` at 1 makes `amount ÷ (quantity × price)`
 * equal to `amount` itself, so the observation's ratio can be pinned exactly
 * by the `amount` passed in — the cleanest way to drive `inferFxRatios`'
 * median logic without fighting the ratio formula.
 */
function observation(ticker: string, ratio: Decimal.Value): TradeObservation {
  return { ticker, quantity: new Decimal(1), price: new Decimal(1), amount: new Decimal(ratio) };
}

describe('inferFxRatios', () => {
  it('maps a ticker whose ratio is exactly 1.0 across several observations to null', () => {
    const result = inferFxRatios([
      observation('SAME.PL', 1),
      observation('SAME.PL', 1),
      observation('SAME.PL', 1),
    ]);

    expect(result.get('SAME.PL')).toBeNull();
  });

  it('maps a ticker whose ratio is near 1.0 (within tolerance) to null', () => {
    const result = inferFxRatios([
      observation('NEAR.PL', 1.003),
      observation('NEAR.PL', 0.998),
      observation('NEAR.PL', 1.005), // exactly at the tolerance boundary — still same-currency
    ]);

    expect(result.get('NEAR.PL')).toBeNull();
  });

  it('maps a ticker just outside the tolerance boundary to a non-null FX rate', () => {
    const result = inferFxRatios([observation('EDGE.PL', 1.0051)]);

    expect(result.get('EDGE.PL')).not.toBeNull();
    expect(result.get('EDGE.PL')?.toString()).toBe('1.0051');
  });

  it('maps a ticker with a consistent non-1.0 ratio to that ratio', () => {
    const result = inferFxRatios([
      observation('CONV.US', 0.92),
      observation('CONV.US', 0.92),
      observation('CONV.US', 0.92),
    ]);

    expect(result.get('CONV.US')?.toString()).toBe('0.92');
  });

  it('uses the median, not the mean, so a single outlier does not skew the result', () => {
    // Sorted: 0.30, 0.90, 0.91, 0.92, 0.93 — median is 0.91 (the middle value).
    // The mean of the same five values would be 0.792, well away from the
    // consistent cluster around 0.9.
    const result = inferFxRatios([
      observation('OUT.US', 0.9),
      observation('OUT.US', 0.91),
      observation('OUT.US', 0.92),
      observation('OUT.US', 0.93),
      observation('OUT.US', 0.3), // the outlier
    ]);

    expect(result.get('OUT.US')?.toString()).toBe('0.91');
  });

  it('handles an even number of observations by averaging the two middle values', () => {
    // Sorted: 0.90, 0.91, 0.92, 0.93 — median is (0.91 + 0.92) / 2 = 0.915.
    const result = inferFxRatios([
      observation('EVEN.US', 0.93),
      observation('EVEN.US', 0.9),
      observation('EVEN.US', 0.92),
      observation('EVEN.US', 0.91),
    ]);

    expect(result.get('EVEN.US')?.toString()).toBe('0.915');
  });

  it('handles a ticker with only one observation', () => {
    const result = inferFxRatios([observation('SINGLE.US', 0.85)]);

    expect(result.get('SINGLE.US')?.toString()).toBe('0.85');
  });

  it('keeps tickers independent of each other', () => {
    const result = inferFxRatios([
      observation('A.PL', 1),
      observation('B.US', 0.9),
      observation('A.PL', 1),
      observation('B.US', 0.9),
    ]);

    expect(result.get('A.PL')).toBeNull();
    expect(result.get('B.US')?.toString()).toBe('0.9');
  });

  it('skips an observation with zero quantity or zero price rather than dividing by zero', () => {
    const result = inferFxRatios([
      {
        ticker: 'ZERO.PL',
        quantity: new Decimal(0),
        price: new Decimal(50),
        amount: new Decimal(0),
      },
      {
        ticker: 'ZERO.PL',
        quantity: new Decimal(10),
        price: new Decimal(0),
        amount: new Decimal(0),
      },
    ]);

    expect(result.has('ZERO.PL')).toBe(false);
  });

  it('returns an empty map for no observations at all', () => {
    expect(inferFxRatios([]).size).toBe(0);
  });
});
