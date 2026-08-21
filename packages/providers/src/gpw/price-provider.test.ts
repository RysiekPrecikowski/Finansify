import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currency, instrumentId, Temporal } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ fetchGpwChart: vi.fn() }));

import { fetchGpwChart } from './client';
import { gpwPriceProvider } from './price-provider';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf-8'));

const PKN = instrumentId('00000000-0000-4000-9000-000000000030');
const ref = {
  instrumentId: PKN,
  provider: 'gpw' as const,
  symbol: 'PLPKN0000018',
  currency: currency('PLN'),
  kind: 'equity' as const,
};

describe('gpwPriceProvider.capabilitiesFor', () => {
  it('serves history for equities and ETFs', () => {
    expect(gpwPriceProvider.capabilitiesFor('equity')).toEqual({ history: true, spot: false });
    expect(gpwPriceProvider.capabilitiesFor('etf')).toEqual({ history: true, spot: false });
  });

  it('refuses fund and bond — TFI/PPK belongs to bankier, Catalyst valuation is ADR 0023', () => {
    expect(gpwPriceProvider.capabilitiesFor('fund')).toEqual({ history: false, spot: false });
    expect(gpwPriceProvider.capabilitiesFor('bond')).toEqual({ history: false, spot: false });
  });
});

describe('gpwPriceProvider.fetchDailyBars', () => {
  it('parses a real captured response into dated, PLN-denominated bars', async () => {
    vi.mocked(fetchGpwChart).mockResolvedValue(fixture('pkn-1m.json'));

    const bars = await gpwPriceProvider.fetchDailyBars(ref, Temporal.PlainDate.from('2026-07-21'));

    expect(bars).toHaveLength(23);
    expect(bars[0]!.close.currency).toBe(currency('PLN'));
    expect(bars[0]!.close.amount.toFixed(2)).toBe('149.16');
    expect(bars[0]!.date.toString()).toBe('2026-07-21');
    expect(bars[0]!.instrumentId).toBe(PKN);
  });

  it('asks for the smallest window that covers `from`, and falls back to ARCH beyond one year', async () => {
    vi.mocked(fetchGpwChart).mockResolvedValue(fixture('pkn-1m.json'));
    const today = Temporal.Now.plainDateISO('Europe/Warsaw');

    await gpwPriceProvider.fetchDailyBars(ref, today.subtract({ days: 10 }));
    expect(fetchGpwChart).toHaveBeenLastCalledWith('PLPKN0000018', '14D');

    await gpwPriceProvider.fetchDailyBars(ref, today.subtract({ days: 27 }));
    expect(fetchGpwChart).toHaveBeenLastCalledWith('PLPKN0000018', '1M');

    await gpwPriceProvider.fetchDailyBars(ref, today.subtract({ years: 5 }));
    expect(fetchGpwChart).toHaveBeenLastCalledWith('PLPKN0000018', 'ARCH');
  });

  it('parses the unbounded ARCH response the same way as a fixed window', async () => {
    vi.mocked(fetchGpwChart).mockResolvedValue(fixture('pkn-arch-sample.json'));

    const bars = await gpwPriceProvider.fetchDailyBars(ref, Temporal.PlainDate.from('2020-01-01'));

    expect(bars).toHaveLength(15);
    expect(bars[0]!.date.toString()).toBe('2026-07-31');
    expect(bars.at(-1)!.date.toString()).toBe('2026-08-20');
  });

  it('returns no bars, not a throw, for an isin the endpoint does not recognise', async () => {
    vi.mocked(fetchGpwChart).mockResolvedValue(fixture('unknown-isin.json'));

    const bars = await gpwPriceProvider.fetchDailyBars(ref, Temporal.PlainDate.from('2026-07-21'));

    expect(bars).toEqual([]);
  });

  it('skips a non-positive or non-finite close and keeps the rest of the batch', async () => {
    vi.mocked(fetchGpwChart).mockResolvedValue([
      {
        mode: '14D',
        isin: 'PLPKN0000018',
        data: [
          { t: 1787090400, o: 1, h: 1, l: 1, c: 0, v: 1 },
          { t: 1787176800, o: 155.4, h: 156.5, l: 153.84, c: 156, v: 1066342 },
        ],
      },
    ]);

    const bars = await gpwPriceProvider.fetchDailyBars(ref, Temporal.PlainDate.from('2026-08-10'));

    expect(bars).toHaveLength(1);
    expect(bars[0]!.close.amount.toFixed(0)).toBe('156');
  });
});
