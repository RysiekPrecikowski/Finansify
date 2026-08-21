import { describe, expect, it } from 'vitest';

import { instrumentId } from '../ledger/types';
import { currency, Money } from '../money';
import { Temporal } from '../time';
import { FakeClock, InMemoryMarketPrices, InMemorySymbols } from './in-memory-valuation';
import {
  BACKFILL_BATCH,
  makeBackfillPriceHistory,
  makeReadPrices,
  makeRefreshPrices,
} from './get-prices';
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
  return {
    name: 'yahoo',
    capabilitiesFor: () => ({ history: true, spot: true }),
    fetchDailyBars: (ref) => behaviour(ref),
  };
}

function registryOf(provider: PriceProvider): ReadonlyMap<PriceProvider['name'], PriceProvider> {
  return new Map([[provider.name, provider]]);
}

describe('makeReadPrices', () => {
  it('reports unavailable/never-fetched for an instrument with no bar', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    const readPrices = makeReadPrices({ prices, symbols, clock });

    const result = await readPrices([AAPL]);

    expect(result.get(AAPL)).toEqual({ status: 'unavailable', reason: 'never-fetched' });
  });

  it('reports fresh within the TTL and stale past it, both carrying the close', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save({
      instrumentId: AAPL,
      provider: 'yahoo',
      symbol: 'AAPL',
      currency: currency('USD'),
      kind: 'equity',
    });
    await prices.save([bar(AAPL, '2026-08-13', '150')], 'yahoo');

    const readPrices = makeReadPrices({ prices, symbols, clock });
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
    kind: 'equity',
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

    const refreshPrices = makeRefreshPrices({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await refreshPrices([AAPL]);

    expect(calls).toBe(1);
    expect(report.refreshed).toEqual([AAPL]);
    const stored = await prices.latestFor([AAPL], 'yahoo');
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

    const refreshPrices = makeRefreshPrices({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
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

    const refreshPrices = makeRefreshPrices({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
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

    const refreshPrices = makeRefreshPrices({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await refreshPrices([AAPL]);

    expect(report.failed).toEqual([AAPL]);
    const stored = await prices.latestFor([AAPL], 'yahoo');
    expect(stored.get(AAPL)).toBeUndefined();
  });

  it('falls through to the next provider in the chain and records the fallback', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save({ ...ref, provider: 'gpw', symbol: 'PLAAPL0001' });
    await symbols.save(ref);

    const failing: PriceProvider = {
      name: 'gpw',
      capabilitiesFor: () => ({ history: true, spot: true }),
      fetchDailyBars: () => Promise.reject(new Error('boom')),
    };
    const working = fakeProvider(() => Promise.resolve([bar(AAPL, '2026-08-13', '150')]));

    const refreshPrices = makeRefreshPrices({
      prices,
      symbols,
      providers: new Map([
        ['gpw', failing],
        ['yahoo', working],
      ]),
      clock,
    });
    const report = await refreshPrices([AAPL]);

    expect(report.refreshed).toEqual([AAPL]);
    const stored = await prices.latestFor([AAPL], 'yahoo');
    expect(stored.get(AAPL)?.close.equals(Money.of('150', currency('USD')))).toBe(true);
    expect(symbols.fallbackCount(AAPL, 'gpw')).toBe(1);
  });
});

describe('makeBackfillPriceHistory', () => {
  const ref: ResolvedSymbol = {
    instrumentId: AAPL,
    provider: 'yahoo',
    symbol: 'AAPL',
    currency: currency('USD'),
    kind: 'equity',
  };
  const FROM = Temporal.PlainDate.from('2020-01-01');

  const id = (suffix: string) => instrumentId(`00000000-0000-4000-9000-00000000${suffix}`);

  it('backfills an id with no coverage row; a second call with the same from is a no-op', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save(ref);

    let calls = 0;
    const provider = fakeProvider(() => {
      calls += 1;
      return Promise.resolve([bar(AAPL, '2020-01-02', '100')]);
    });

    const backfill = makeBackfillPriceHistory({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await backfill([AAPL], FROM);

    expect(calls).toBe(1);
    expect(report.refreshed).toEqual([AAPL]);
    expect(report.remaining).toBe(0);

    const second = await backfill([AAPL], FROM);
    expect(calls).toBe(1);
    expect(second.refreshed).toEqual([]);
  });

  it('re-attempts an id whose coverage is narrower than requested, but skips one already wide enough', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    const narrow = id('0004');
    const wide = id('0005');
    await symbols.save({ ...ref, instrumentId: narrow, symbol: 'NARROW' });
    await symbols.save({ ...ref, instrumentId: wide, symbol: 'WIDE' });

    // Covered from after `from` — the existing coverage doesn't reach far enough back.
    await prices.markCovered([narrow], 'yahoo', Temporal.PlainDate.from('2021-01-01'));
    // Covered from at-or-before `from` — already wide enough.
    await prices.markCovered([wide], 'yahoo', Temporal.PlainDate.from('2019-01-01'));

    const calledFor: string[] = [];
    const provider = fakeProvider((r) => {
      calledFor.push(r.symbol);
      return Promise.resolve([bar(r.instrumentId as typeof AAPL, '2020-01-02', '10')]);
    });

    const backfill = makeBackfillPriceHistory({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await backfill([narrow, wide], FROM);

    expect(calledFor).toEqual(['NARROW']);
    expect(report.refreshed).toEqual([narrow]);
  });

  it('widens coverage even when the provider returns zero usable bars, so the id is never re-asked', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    await symbols.save(ref);

    let calls = 0;
    const provider = fakeProvider(() => {
      calls += 1;
      return Promise.resolve([]);
    });

    const backfill = makeBackfillPriceHistory({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await backfill([AAPL], FROM);

    expect(calls).toBe(1);
    expect(report.refreshed).toEqual([AAPL]);

    const coverage = await prices.coverageFor([AAPL], 'yahoo');
    expect(coverage.get(AAPL)?.equals(FROM)).toBe(true);

    const second = await backfill([AAPL], FROM);
    expect(calls).toBe(1);
    expect(second.refreshed).toEqual([]);
  });

  it('bounds attempted ids by limit, leaving the rest in remaining without calling the provider', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    const ids = [id('0006'), id('0007'), id('0008')];
    for (const [i, instId] of ids.entries()) {
      await symbols.save({ ...ref, instrumentId: instId, symbol: `SYM${i}` });
    }

    const calledFor: string[] = [];
    const provider = fakeProvider((r) => {
      calledFor.push(r.symbol);
      return Promise.resolve([bar(r.instrumentId as typeof AAPL, '2020-01-02', '10')]);
    });

    const backfill = makeBackfillPriceHistory({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await backfill(ids, FROM, 2);

    expect(calledFor).toEqual(['SYM0', 'SYM1']);
    expect(report.refreshed).toEqual([ids[0], ids[1]]);
    expect(report.remaining).toBe(1);
  });

  it('trips the circuit breaker after two consecutive failures, leaving the rest in remaining, not failed', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    const first = id('0009');
    const second = id('000a');
    const third = id('000b');
    for (const [i, instId] of [first, second, third].entries()) {
      await symbols.save({ ...ref, instrumentId: instId, symbol: `SYM${i}` });
    }

    const calledFor: string[] = [];
    const provider = fakeProvider((r) => {
      calledFor.push(r.symbol);
      return Promise.reject(new Error('boom'));
    });

    const backfill = makeBackfillPriceHistory({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await backfill([first, second, third], FROM);

    expect(calledFor).toEqual(['SYM0', 'SYM1']);
    expect(report.failed).toEqual([first, second]);
    expect(report.remaining).toBe(1);

    const coverage = await prices.coverageFor([first, second], 'yahoo');
    expect(coverage.size).toBe(0);
  });

  it('reports an unmapped id without calling the provider, and does not let it count toward the circuit breaker', async () => {
    const clock = new FakeClock(NOW);
    const prices = new InMemoryMarketPrices(clock);
    const symbols = new InMemorySymbols();
    const fail1 = id('000c');
    const unmappedId = id('000d');
    const fail2 = id('000e');
    const ok = id('000f');
    // unmappedId deliberately has no resolved symbol saved.
    for (const [i, instId] of [fail1, fail2, ok].entries()) {
      await symbols.save({ ...ref, instrumentId: instId, symbol: `SYM${i}` });
    }

    const calledFor: string[] = [];
    const provider = fakeProvider((r) => {
      calledFor.push(r.symbol);
      return Promise.reject(new Error('boom'));
    });

    const backfill = makeBackfillPriceHistory({
      prices,
      symbols,
      providers: registryOf(provider),
      clock,
    });
    const report = await backfill([fail1, unmappedId, fail2, ok], FROM);

    // Both real failures were attempted (unmappedId in between did not
    // consume one of the two strikes), so the breaker trips only after
    // fail2 and `ok` is never reached.
    expect(calledFor).toEqual(['SYM0', 'SYM1']);
    expect(report.unmapped).toEqual([unmappedId]);
    expect(report.failed).toEqual([fail1, fail2]);
    expect(report.remaining).toBe(1);
  });

  it('the default limit is BACKFILL_BATCH', () => {
    expect(BACKFILL_BATCH).toBe(8);
  });
});
