import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currency, instrumentId, Temporal } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ fetchBankierFundChart: vi.fn() }));

import { fetchBankierFundChart } from './client';
import { bankierPriceProvider } from './price-provider';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf-8'));

const AGF04 = instrumentId('00000000-0000-4000-9000-000000000040');
const ref = {
  instrumentId: AGF04,
  provider: 'bankier' as const,
  symbol: 'AGF04',
  currency: currency('PLN'),
  kind: 'fund' as const,
};

describe('bankierPriceProvider.capabilitiesFor', () => {
  it('serves history for fund (TFI/PPK units)', () => {
    expect(bankierPriceProvider.capabilitiesFor('fund')).toEqual({ history: true, spot: false });
  });

  it('claims nothing for kinds gpw already covers with full history', () => {
    expect(bankierPriceProvider.capabilitiesFor('equity')).toEqual({
      history: false,
      spot: false,
    });
    expect(bankierPriceProvider.capabilitiesFor('etf')).toEqual({ history: false, spot: false });
    expect(bankierPriceProvider.capabilitiesFor('catalyst_bond')).toEqual({
      history: false,
      spot: false,
    });
    expect(bankierPriceProvider.capabilitiesFor('bond')).toEqual({ history: false, spot: false });
  });
});

describe('bankierPriceProvider.fetchDailyBars', () => {
  it('parses a real captured response into dated, PLN-denominated bars', async () => {
    vi.mocked(fetchBankierFundChart).mockResolvedValue(fixture('agf04-1m-sample.json'));

    const bars = await bankierPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-08-05'),
    );

    expect(bars).toHaveLength(12);
    expect(bars[0]!.close.currency).toBe(currency('PLN'));
    expect(bars[0]!.close.amount.toFixed(2)).toBe('1910.17');
    expect(bars[0]!.date.toString()).toBe('2026-08-05');
    expect(bars[0]!.instrumentId).toBe(AGF04);
    expect(bars.at(-1)!.date.toString()).toBe('2026-08-20');
    expect(bars.at(-1)!.close.amount.toFixed(2)).toBe('1909.34');
  });

  it('asks for the smallest range that covers `from`, and falls back to `max` beyond 5 years', async () => {
    vi.mocked(fetchBankierFundChart).mockResolvedValue(fixture('agf04-1m-sample.json'));
    const today = Temporal.Now.plainDateISO('Europe/Warsaw');

    await bankierPriceProvider.fetchDailyBars(ref, today.subtract({ days: 10 }));
    expect(fetchBankierFundChart).toHaveBeenLastCalledWith('AGF04', '1m');

    await bankierPriceProvider.fetchDailyBars(ref, today.subtract({ days: 100 }));
    expect(fetchBankierFundChart).toHaveBeenLastCalledWith('AGF04', '6m');

    await bankierPriceProvider.fetchDailyBars(ref, today.subtract({ years: 6 }));
    expect(fetchBankierFundChart).toHaveBeenLastCalledWith('AGF04', 'max');
  });

  it('returns no bars, not a throw, for a symbol the endpoint does not recognise', async () => {
    vi.mocked(fetchBankierFundChart).mockResolvedValue(fixture('unknown-symbol.json'));

    const bars = await bankierPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-07-21'),
    );

    expect(bars).toEqual([]);
  });

  it('refuses a response whose currency disagrees with the instrument’s', async () => {
    vi.mocked(fetchBankierFundChart).mockResolvedValue({
      data: [
        {
          data: [[1787176800000, 1909.34]],
          profile_data: { currency: 'EUR' },
        },
      ],
    });

    await expect(
      bankierPriceProvider.fetchDailyBars(ref, Temporal.PlainDate.from('2026-08-19')),
    ).rejects.toThrow(/EUR.*PLN/);
  });

  it('skips a non-positive or non-finite close and keeps the rest of the batch', async () => {
    vi.mocked(fetchBankierFundChart).mockResolvedValue({
      data: [
        {
          data: [
            [1787090400000, 0],
            [1787176800000, 1909.34],
          ],
          profile_data: { currency: 'PLN' },
        },
      ],
    });

    const bars = await bankierPriceProvider.fetchDailyBars(
      ref,
      Temporal.PlainDate.from('2026-08-10'),
    );

    expect(bars).toHaveLength(1);
    expect(bars[0]!.close.amount.toFixed(2)).toBe('1909.34');
  });
});
