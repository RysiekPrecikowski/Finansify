import { describe, expect, it } from 'vitest';

import { instrumentId } from '../ledger/types';
import { currency, Money } from '../money';
import { Temporal } from '../time';
import { FakeClock, InMemoryMarketPrices, InMemorySymbols } from './in-memory-valuation';
import { makeReadPrices, makeRefreshPrices } from './get-prices';
import { type PriceProvider } from './ports';
import { type PriceBar, type ResolvedSymbol } from './types';

const AAPL = instrumentId('00000000-0000-4000-9000-000000000001');
const VOO = instrumentId('00000000-0000-4000-9000-000000000002');
const NOW = Temporal.Instant.from('2026-08-13T12:00:00Z');

function bar(id: typeof AAPL, date: string, close: string): PriceBar {
  return {
    instrumentId: id,
    date: Temporal.PlainDate.from(date),
    close: Money.of(close, currency('USD')),
  };
}

function fakeProvider(
  behaviour: (ref: ResolvedSymbol) => Promise<readonly PriceBar[]>,
): PriceProvider {
  return { name: 'yahoo', fetchDailyBars: (ref) => behaviour(ref) };
}

describe('makeReadPrices', () => {
  it('reports unavailable/never-fetched for an instrument with no bar', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const readPrices = makeReadPrices({ prices, clock });

    const result = await readPrices([AAPL]);

    expect(result.get(AAPL)).toEqual({ status: 'unavailable', reason: 'never-fetched' });
  });

  it('reports fresh within the TTL and stale past it, both carrying the close', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    await prices.save([bar(AAPL, '2026-08-13', '150')], 'yahoo');

    const readPrices = makeReadPrices({ prices, clock });
    const fresh = await readPrices([AAPL]);
    expect(fresh.get(AAPL)?.status).toBe('fresh');
    expect(
      (fresh.get(AAPL) as { close: Money }).close.equals(Money.of('150', currency('USD'))),
    ).toBe(true);

    clock.advance({ minutes: 16 });
    const stale = await readPrices([AAPL]);
    expect(stale.get(AAPL)?.status).toBe('stale');
    expect(
      (stale.get(AAPL) as { close: Money }).close.equals(Money.of('150', currency('USD'))),
    ).toBe(true);
  });
});

describe('makeRefreshPrices', () => {
  const ref: ResolvedSymbol = {
    instrumentId: AAPL,
    provider: 'yahoo',
    symbol: 'AAPL',
    currency: currency('USD'),
  };

  it('fetches and saves a due instrument, leaving a fresh one untouched', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save(ref);

    let calls = 0;
    const provider = fakeProvider((r) => {
      calls += 1;
      return Promise.resolve([bar(r.instrumentId as typeof AAPL, '2026-08-13', '150')]);
    });

    const refreshPrices = makeRefreshPrices({ prices, symbols, provider, clock });
    const report = await refreshPrices([AAPL]);

    expect(calls).toBe(1);
    expect(report.refreshed).toEqual([AAPL]);
    const stored = await prices.latestFor([AAPL]);
    expect(stored.get(AAPL)?.close.equals(Money.of('150', currency('USD')))).toBe(true);

    // Second call within the TTL should not refetch.
    const secondReport = await refreshPrices([AAPL]);
    expect(calls).toBe(1);
    expect(secondReport.refreshed).toEqual([]);
  });

  it('reports unmapped instead of calling the provider when no symbol is resolved', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    let calls = 0;
    const provider = fakeProvider(() => {
      calls += 1;
      return Promise.resolve([]);
    });

    const refreshPrices = makeRefreshPrices({ prices, symbols, provider, clock });
    const report = await refreshPrices([AAPL]);

    expect(calls).toBe(0);
    expect(report.unmapped).toEqual([AAPL]);
  });

  it('trips the circuit breaker after two consecutive failures and leaves the rest for next round', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save(ref);
    await symbols.save({ ...ref, instrumentId: VOO, symbol: 'VOO' });
    const third = instrumentId('00000000-0000-4000-9000-000000000003');
    await symbols.save({ ...ref, instrumentId: third, symbol: 'THIRD' });

    let calls = 0;
    const provider = fakeProvider(() => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    });

    const refreshPrices = makeRefreshPrices({ prices, symbols, provider, clock });
    const report = await refreshPrices([AAPL, VOO, third]);

    expect(calls).toBe(2);
    expect(report.failed).toEqual([AAPL, VOO]);
    expect(report.refreshed).toEqual([]);
  });

  it('rejects a bar whose date is in the future rather than saving it', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save(ref);

    const provider = fakeProvider(() => Promise.resolve([bar(AAPL, '2099-01-01', '150')]));

    const refreshPrices = makeRefreshPrices({ prices, symbols, provider, clock });
    const report = await refreshPrices([AAPL]);

    expect(report.failed).toEqual([AAPL]);
    const stored = await prices.latestFor([AAPL]);
    expect(stored.get(AAPL)).toBeUndefined();
  });
});
