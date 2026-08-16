import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, type Currency } from '../money';
import { Temporal } from '../time';
import { isFxSeriesDue, pairSeries, SameCurrencyPairError, summarizeFxSeries } from './fx-series';
import { type FxRate } from './types';

const PLN = currency('PLN');
const EUR = currency('EUR');
const USD = currency('USD');
const GBP = currency('GBP');

const day = (iso: string) => Temporal.PlainDate.from(iso);

const rate = (code: Currency, iso: string, mid: string): FxRate => ({
  currency: code,
  date: day(iso),
  mid: new Decimal(mid),
});

/** NBP table A, three real publication days (2026-08-03, 04, 05). */
const stored = new Map<Currency, readonly FxRate[]>([
  [
    USD,
    [
      rate(USD, '2026-08-03', '3.7330'),
      rate(USD, '2026-08-04', '3.7468'),
      rate(USD, '2026-08-05', '3.7320'),
    ],
  ],
  [
    EUR,
    [
      rate(EUR, '2026-08-03', '4.2500'),
      rate(EUR, '2026-08-04', '4.2600'),
      rate(EUR, '2026-08-05', '4.2550'),
    ],
  ],
]);

describe('pairSeries', () => {
  it('reads a foreign currency against PLN straight off the table', () => {
    const points = pairSeries({ base: USD, quote: PLN }, stored);

    expect(points.map((point) => point.date.toString())).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
    expect(points[0]!.rate.toFixed(4)).toBe('3.7330');
    expect(points[2]!.rate.toFixed(4)).toBe('3.7320');
  });

  it('inverts the table for a PLN-based pair rather than storing the other direction', () => {
    const points = pairSeries({ base: PLN, quote: USD }, stored);

    // 1 / 3.7330 — USD per PLN, the same fact read the other way round.
    expect(points[0]!.rate.toFixed(6)).toBe('0.267881');
  });

  it('crosses two foreign currencies through PLN, which is never stored as a pair', () => {
    const points = pairSeries({ base: EUR, quote: USD }, stored);

    // 4.2500 / 3.7330
    expect(points[0]!.rate.toFixed(6)).toBe('1.138495');
    expect(points[1]!.rate.toFixed(6)).toBe('1.136970');
  });

  it('round-trips a cross pair back to itself', () => {
    const forward = pairSeries({ base: EUR, quote: USD }, stored);
    const back = pairSeries({ base: USD, quote: EUR }, stored);

    for (const [index, point] of forward.entries()) {
      expect(point.rate.times(back[index]!.rate).toFixed(12)).toBe('1.000000000000');
    }
  });

  it('keeps only the dates both legs were published on, never filling a gap', () => {
    const ragged = new Map<Currency, readonly FxRate[]>([
      [USD, [rate(USD, '2026-08-03', '3.7330'), rate(USD, '2026-08-04', '3.7468')]],
      // GBP joined the table a day late — the pair starts when both exist.
      [GBP, [rate(GBP, '2026-08-04', '5.0100')]],
    ]);

    const points = pairSeries({ base: GBP, quote: USD }, ragged);

    expect(points).toHaveLength(1);
    expect(points[0]!.date.toString()).toBe('2026-08-04');
  });

  it('returns nothing for a currency with no rows, rather than substituting one', () => {
    expect(pairSeries({ base: GBP, quote: PLN }, stored)).toEqual([]);
  });

  it('sorts oldest first whatever order the rows arrived in', () => {
    const shuffled = new Map<Currency, readonly FxRate[]>([
      [
        USD,
        [
          rate(USD, '2026-08-05', '3.7320'),
          rate(USD, '2026-08-03', '3.7330'),
          rate(USD, '2026-08-04', '3.7468'),
        ],
      ],
    ]);

    expect(pairSeries({ base: USD, quote: PLN }, shuffled).map((p) => p.date.toString())).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });

  it('refuses a pair of one currency instead of drawing a flat line at 1', () => {
    expect(() => pairSeries({ base: USD, quote: USD }, stored)).toThrow(SameCurrencyPairError);
    expect(() => pairSeries({ base: PLN, quote: PLN }, stored)).toThrow(SameCurrencyPairError);
  });
});

describe('summarizeFxSeries', () => {
  const pair = { base: USD, quote: PLN };

  it('reports the newest point, the one before it, and both changes', () => {
    const summary = summarizeFxSeries(pair, pairSeries(pair, stored));

    expect(summary?.latest.rate.toFixed(4)).toBe('3.7320');
    expect(summary?.previous?.rate.toFixed(4)).toBe('3.7468');
    // Against yesterday, and against the start of the window.
    expect(summary?.change?.toFixed(4)).toBe('-0.0148');
    expect(summary?.changeOverWindow?.toFixed(4)).toBe('-0.0010');
  });

  it('has no change to report on a one-point series', () => {
    const single = [{ date: day('2026-08-05'), rate: new Decimal('3.7320') }];
    const summary = summarizeFxSeries(pair, single);

    expect(summary?.previous).toBeNull();
    expect(summary?.change).toBeNull();
    expect(summary?.changeOverWindow).toBeNull();
  });

  it('is null for an empty series rather than a zeroed summary', () => {
    expect(summarizeFxSeries(pair, [])).toBeNull();
  });
});

describe('isFxSeriesDue', () => {
  const today = day('2026-08-17'); // a Monday
  const window = { from: day('2026-08-01'), to: today };

  it('is due when nothing is stored at all', () => {
    expect(isFxSeriesDue([], window, today)).toBe(true);
  });

  it('is due when the stored history starts after the window does', () => {
    const short = [rate(USD, '2026-08-10', '3.72')];
    expect(isFxSeriesDue(short, window, today)).toBe(true);
  });

  it('is not due when a Friday print is the newest and today is the Monday after', () => {
    const covered = [rate(USD, '2026-08-01', '3.73'), rate(USD, '2026-08-14', '3.72')];
    expect(isFxSeriesDue(covered, window, today)).toBe(false);
  });

  it('is due once the newest print is older than a long weekend', () => {
    const stale = [rate(USD, '2026-08-01', '3.73'), rate(USD, '2026-08-11', '3.72')];
    expect(isFxSeriesDue(stale, window, today)).toBe(true);
  });
});
