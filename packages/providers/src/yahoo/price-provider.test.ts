import { currency, instrumentId, Temporal } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  yahooFinance: { chart: vi.fn() },
  callYahoo: (fn: () => Promise<unknown>) => fn(),
}));

import { yahooFinance } from './client';
import { yahooPriceProvider } from './price-provider';

const PKN = instrumentId('00000000-0000-4000-9000-000000000020');
const ref = {
  instrumentId: PKN,
  provider: 'yahoo' as const,
  symbol: 'PKN.WA',
  currency: currency('PLN'),
};

describe('yahooPriceProvider', () => {
  it('rounds the float32 artifact to priceHint and dates the bar in the exchange timezone', async () => {
    vi.mocked(yahooFinance.chart).mockResolvedValue({
      meta: { exchangeTimezoneName: 'Europe/Warsaw', priceHint: 2 },
      quotes: [{ date: new Date('2026-08-13T14:00:00Z'), close: 155.67999267578125 }],
    } as never);

    const bars = await yahooPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-08-08'),
    );

    expect(bars).toHaveLength(1);
    expect(bars[0]!.close.amount.toFixed(2)).toBe('155.68');
    expect(bars[0]!.close.currency).toBe(currency('PLN'));
    expect(bars[0]!.date.toString()).toBe('2026-08-13');
  });

  it('refuses the response when priceHint is absent rather than skipping rounding', async () => {
    vi.mocked(yahooFinance.chart).mockResolvedValue({
      meta: { exchangeTimezoneName: 'Europe/Warsaw' },
      quotes: [{ date: new Date('2026-08-13T14:00:00Z'), close: 155.67999267578125 }],
    } as never);

    await expect(
      yahooPriceProvider.fetchDailyBars(ref, Temporal.PlainDate.from('2026-08-08')),
    ).rejects.toThrow(/priceHint/);
  });

  it('skips a bar with an absent close and keeps the rest of the batch', async () => {
    vi.mocked(yahooFinance.chart).mockResolvedValue({
      meta: { exchangeTimezoneName: 'Europe/Warsaw', priceHint: 2 },
      quotes: [
        { date: new Date('2026-08-12T14:00:00Z'), close: undefined },
        { date: new Date('2026-08-13T14:00:00Z'), close: 155.68 },
      ],
    } as never);

    const bars = await yahooPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-08-08'),
    );

    expect(bars).toHaveLength(1);
    expect(bars[0]!.date.toString()).toBe('2026-08-13');
  });

  it('drops a bar with a null or non-positive close instead of saving garbage', async () => {
    vi.mocked(yahooFinance.chart).mockResolvedValue({
      meta: { exchangeTimezoneName: 'Europe/Warsaw', priceHint: 2 },
      quotes: [
        { date: new Date('2026-08-12T14:00:00Z'), close: null },
        { date: new Date('2026-08-13T14:00:00Z'), close: 0 },
      ],
    } as never);

    const bars = await yahooPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-08-08'),
    );

    expect(bars).toHaveLength(0);
  });

  it('divides a GBp (pence) close by 100 before storing it as GBP', async () => {
    vi.mocked(yahooFinance.chart).mockResolvedValue({
      meta: { exchangeTimezoneName: 'Europe/London', priceHint: 2, currency: 'GBp' },
      quotes: [{ date: new Date('2026-08-13T14:00:00Z'), close: 10530.5 }],
    } as never);

    const bars = await yahooPriceProvider.fetchDailyBars(
      { ...ref, currency: currency('GBP') },
      Temporal.PlainDate.from('2026-08-08'),
    );

    expect(bars).toHaveLength(1);
    expect(bars[0]!.close.amount.toFixed(4)).toBe('105.3050');
    expect(bars[0]!.close.currency).toBe(currency('GBP'));
  });

  it('leaves a non-GBp bar unaffected', async () => {
    vi.mocked(yahooFinance.chart).mockResolvedValue({
      meta: { exchangeTimezoneName: 'Europe/Warsaw', priceHint: 2, currency: 'PLN' },
      quotes: [{ date: new Date('2026-08-13T14:00:00Z'), close: 155.68 }],
    } as never);

    const bars = await yahooPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-08-08'),
    );

    expect(bars[0]!.close.amount.toFixed(2)).toBe('155.68');
  });
});
