import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency } from '../money';
import { Temporal } from '../time';
import { FakeClock, InMemoryFxRates } from './in-memory-valuation';
import { makeReadFxRates, makeRefreshFxRates } from './get-fx-rates';
import { type FxRateProvider } from './ports';
import { type FxRate } from './types';

const NOW = Temporal.Instant.from('2026-08-13T12:00:00Z');
const USD = currency('USD');
const EUR = currency('EUR');

function rate(code: typeof USD, date: string, mid: string): FxRate {
  return { currency: code, date: Temporal.PlainDate.from(date), mid: new Decimal(mid) };
}

describe('makeReadFxRates', () => {
  it('reports unavailable when no rate has ever been fetched', async () => {
    const clock = new FakeClock(NOW);
    const fx = new InMemoryFxRates(clock);
    const readFxRates = makeReadFxRates({ fx, clock });

    const result = await readFxRates([USD]);

    expect(result.get(USD)).toEqual({ status: 'unavailable' });
  });

  it('carries the last known mid forward as stale past the TTL', async () => {
    const clock = new FakeClock(NOW);
    const fx = new InMemoryFxRates(clock);
    await fx.save([rate(USD, '2026-08-12', '3.7362')], 'nbp');

    const readFxRates = makeReadFxRates({ fx, clock });
    expect((await readFxRates([USD])).get(USD)?.status).toBe('fresh');

    clock.advance({ minutes: 16 });
    const stale = await readFxRates([USD]);
    expect(stale.get(USD)?.status).toBe('stale');
    expect((stale.get(USD) as { mid: Decimal }).mid.toString()).toBe('3.7362');
  });
});

describe('makeRefreshFxRates', () => {
  it('fetches the whole table once and saves every currency it returns', async () => {
    const clock = new FakeClock(NOW);
    const fx = new InMemoryFxRates(clock);
    let calls = 0;
    const provider: FxRateProvider = {
      name: 'nbp',
      // Unused here; `fetchSeriesTo` is exercised in `fx-series.test.ts`.
      fetchSeriesTo: () => Promise.resolve([]),
      fetchTableTo: () => {
        calls += 1;
        return Promise.resolve([
          rate(USD, '2026-08-13', '3.7362'),
          rate(EUR, '2026-08-13', '4.3058'),
        ]);
      },
    };

    const refreshFxRates = makeRefreshFxRates({ fx, provider, clock });
    const report = await refreshFxRates([USD, EUR]);

    expect(calls).toBe(1);
    expect([...report.refreshed].sort()).toEqual([EUR, USD].sort());
    const stored = await fx.latestFor([USD, EUR], 'nbp');
    expect(stored.get(USD)?.mid.toString()).toBe('3.7362');
  });

  it('refuses a zero mid rather than storing one that later divides to Infinity', async () => {
    const clock = new FakeClock(NOW);
    const fx = new InMemoryFxRates(clock);
    const provider: FxRateProvider = {
      name: 'nbp',
      // Unused here; `fetchSeriesTo` is exercised in `fx-series.test.ts`.
      fetchSeriesTo: () => Promise.resolve([]),
      fetchTableTo: () =>
        Promise.resolve([rate(USD, '2026-08-13', '0'), rate(EUR, '2026-08-13', '4.3058')]),
    };

    const refreshFxRates = makeRefreshFxRates({ fx, provider, clock });
    const report = await refreshFxRates([USD, EUR]);

    expect(report.failed).toEqual([USD]);
    expect(report.refreshed).toEqual([EUR]);
    expect((await fx.latestFor([USD], 'nbp')).get(USD)).toBeUndefined();
  });

  it('refuses a negative mid', async () => {
    const clock = new FakeClock(NOW);
    const fx = new InMemoryFxRates(clock);
    const provider: FxRateProvider = {
      name: 'nbp',
      // Unused here; `fetchSeriesTo` is exercised in `fx-series.test.ts`.
      fetchSeriesTo: () => Promise.resolve([]),
      fetchTableTo: () => Promise.resolve([rate(USD, '2026-08-13', '-3.7362')]),
    };

    const refreshFxRates = makeRefreshFxRates({ fx, provider, clock });
    const report = await refreshFxRates([USD]);

    expect(report.failed).toEqual([USD]);
    expect((await fx.latestFor([USD], 'nbp')).get(USD)).toBeUndefined();
  });

  it('does not call the provider when every requested currency is already fresh', async () => {
    const clock = new FakeClock(NOW);
    const fx = new InMemoryFxRates(clock);
    await fx.save([rate(USD, '2026-08-13', '3.7362')], 'nbp');
    let calls = 0;
    const provider: FxRateProvider = {
      name: 'nbp',
      // Unused here; `fetchSeriesTo` is exercised in `fx-series.test.ts`.
      fetchSeriesTo: () => Promise.resolve([]),
      fetchTableTo: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    };

    const refreshFxRates = makeRefreshFxRates({ fx, provider, clock });
    await refreshFxRates([USD]);

    expect(calls).toBe(0);
  });
});
