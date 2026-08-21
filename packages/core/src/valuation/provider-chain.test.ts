import { describe, expect, it } from 'vitest';

import { instrumentId } from '../ledger/types';
import { currency, Money } from '../money';
import { Temporal } from '../time';
import { type PriceProvider } from './ports';
import { fetchWithFallback, selectProvider } from './provider-chain';
import { type PriceBar, type ResolvedSymbol } from './types';
import { type ProviderName } from './vocabulary';

const AAPL = instrumentId('00000000-0000-4000-9000-000000000001');

function bar(close: string): PriceBar {
  return {
    instrumentId: AAPL,
    date: Temporal.PlainDate.from('2026-08-13'),
    close: Money.of(close, currency('USD')),
  };
}

function ref(provider: ResolvedSymbol['provider'], symbol: string): ResolvedSymbol {
  return { instrumentId: AAPL, provider, symbol, currency: currency('USD'), kind: 'equity' };
}

function providerWith(
  name: PriceProvider['name'],
  capabilities: { history: boolean; spot: boolean },
): PriceProvider {
  return {
    name,
    capabilitiesFor: () => capabilities,
    fetchDailyBars: () => Promise.resolve([bar('1')]),
  };
}

describe('selectProvider', () => {
  it('preserves chain order among providers that support the need', () => {
    const chain = [ref('gpw', 'ISIN1'), ref('yahoo', 'AAPL')];
    const registry = new Map<ProviderName, PriceProvider>([
      ['gpw', providerWith('gpw', { history: true, spot: true })],
      ['yahoo', providerWith('yahoo', { history: true, spot: true })],
    ]);

    const result = selectProvider(chain, registry, 'equity', 'history');

    expect(result.map((r) => r.provider)).toEqual(['gpw', 'yahoo']);
  });

  it('skips a provider that does not support the need for this kind, without reordering the rest', () => {
    const chain = [ref('bankier', 'PKN'), ref('gpw', 'ISIN1')];
    const registry = new Map<ProviderName, PriceProvider>([
      ['bankier', providerWith('bankier', { history: false, spot: true })],
      ['gpw', providerWith('gpw', { history: true, spot: true })],
    ]);

    const result = selectProvider(chain, registry, 'equity', 'history');

    expect(result.map((r) => r.provider)).toEqual(['gpw']);
  });

  it('returns an empty list, not a throw, when no provider in the chain supports the need', () => {
    const chain = [ref('bankier', 'PKN')];
    const registry = new Map<ProviderName, PriceProvider>([
      ['bankier', providerWith('bankier', { history: false, spot: true })],
    ]);

    const result = selectProvider(chain, registry, 'equity', 'history');

    expect(result).toEqual([]);
  });

  it('skips a chain entry whose provider is not registered at all', () => {
    const chain = [ref('gpw', 'ISIN1')];
    const registry = new Map<ProviderName, PriceProvider>();

    const result = selectProvider(chain, registry, 'equity', 'history');

    expect(result).toEqual([]);
  });
});

describe('fetchWithFallback', () => {
  it('returns the first candidate that succeeds, with no fallback recorded', async () => {
    const chain = [ref('gpw', 'ISIN1'), ref('yahoo', 'AAPL')];
    const registry = new Map<ProviderName, PriceProvider>([
      ['gpw', providerWith('gpw', { history: true, spot: true })],
      ['yahoo', providerWith('yahoo', { history: true, spot: true })],
    ]);

    const outcome = await fetchWithFallback(chain, registry, 'equity', 'history', (provider, r) =>
      provider.fetchDailyBars(r, Temporal.PlainDate.from('2026-01-01')),
    );

    expect(outcome?.source).toBe('gpw');
    expect(outcome?.fallenBackFrom).toEqual([]);
  });

  it('falls through to the next candidate on failure and records every provider it fell back from', async () => {
    const chain = [ref('gpw', 'ISIN1'), ref('yahoo', 'AAPL')];
    const failing: PriceProvider = {
      name: 'gpw',
      capabilitiesFor: () => ({ history: true, spot: true }),
      fetchDailyBars: () => Promise.reject(new Error('boom')),
    };
    const registry = new Map<ProviderName, PriceProvider>([
      ['gpw', failing],
      ['yahoo', providerWith('yahoo', { history: true, spot: true })],
    ]);

    const outcome = await fetchWithFallback(chain, registry, 'equity', 'history', (provider, r) =>
      provider.fetchDailyBars(r, Temporal.PlainDate.from('2026-01-01')),
    );

    expect(outcome?.source).toBe('yahoo');
    expect(outcome?.fallenBackFrom).toEqual(['gpw']);
  });

  it('starts from the top of the chain again on a fresh call — non-sticky', async () => {
    const chain = [ref('gpw', 'ISIN1'), ref('yahoo', 'AAPL')];
    const failing: PriceProvider = {
      name: 'gpw',
      capabilitiesFor: () => ({ history: true, spot: true }),
      fetchDailyBars: () => Promise.reject(new Error('boom')),
    };
    const registry = new Map<ProviderName, PriceProvider>([
      ['gpw', failing],
      ['yahoo', providerWith('yahoo', { history: true, spot: true })],
    ]);
    const attempt = (provider: PriceProvider, r: ResolvedSymbol) =>
      provider.fetchDailyBars(r, Temporal.PlainDate.from('2026-01-01'));

    const first = await fetchWithFallback(chain, registry, 'equity', 'history', attempt);
    const second = await fetchWithFallback(chain, registry, 'equity', 'history', attempt);

    expect(first?.fallenBackFrom).toEqual(['gpw']);
    expect(second?.fallenBackFrom).toEqual(['gpw']);
  });

  it('returns null rather than throwing when no candidate in the chain can serve this need', async () => {
    const chain = [ref('bankier', 'PKN')];
    const registry = new Map<ProviderName, PriceProvider>([
      ['bankier', providerWith('bankier', { history: false, spot: true })],
    ]);

    const outcome = await fetchWithFallback(chain, registry, 'equity', 'history', (provider, r) =>
      provider.fetchDailyBars(r, Temporal.PlainDate.from('2026-01-01')),
    );

    expect(outcome).toBeNull();
  });

  it('returns null when every capable candidate fails', async () => {
    const chain = [ref('gpw', 'ISIN1')];
    const failing: PriceProvider = {
      name: 'gpw',
      capabilitiesFor: () => ({ history: true, spot: true }),
      fetchDailyBars: () => Promise.reject(new Error('boom')),
    };
    const registry = new Map<ProviderName, PriceProvider>([['gpw', failing]]);

    const outcome = await fetchWithFallback(chain, registry, 'equity', 'history', (provider, r) =>
      provider.fetchDailyBars(r, Temporal.PlainDate.from('2026-01-01')),
    );

    expect(outcome).toBeNull();
  });
});
