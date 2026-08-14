import { describe, expect, it } from 'vitest';

import { InMemoryInstruments } from '../ledger/in-memory-ledger';
import { currency, type Currency } from '../money';
import { InMemorySymbols } from '../valuation/in-memory-valuation';
import { type InstrumentSearchProvider } from '../valuation/ports';
import { type ConfirmedCandidate, type InstrumentCandidate } from '../valuation/types';
import { makeSelectInstrument } from './select-instrument';

/**
 * `confirm()` is the only enforcement of the resolvability invariant, and the
 * only thing standing between a form POST and a row in the global
 * `instruments` table (ADR 0010). These specify what it is allowed to let
 * through, from the outside — the use case is handed a provider that answers
 * however the test needs, never the real adapter.
 */
function providerReturning(
  confirmed: ConfirmedCandidate | null,
  onConfirm?: (candidate: InstrumentCandidate) => void,
): InstrumentSearchProvider {
  return {
    name: 'yahoo',
    search: () => Promise.resolve([]),
    confirm: (candidate) => {
      onConfirm?.(candidate);
      return Promise.resolve(confirmed);
    },
  };
}

const CONFIRMED: ConfirmedCandidate = {
  provider: 'yahoo',
  symbol: 'IWDA.AS',
  name: 'iShares Core MSCI World UCITS ETF',
  exchange: 'AMS',
  currency: currency('EUR'),
  kind: 'etf',
  isin: null,
};

function selectionOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'candidate',
    provider: 'yahoo',
    symbol: 'IWDA.AS',
    name: 'iShares Core MSCI World UCITS ETF',
    ...overrides,
  };
}

describe('makeSelectInstrument', () => {
  it('persists what confirm() answered, not what the client submitted', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    let seen: InstrumentCandidate | undefined;
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols,
      provider: providerReturning(CONFIRMED, (candidate) => (seen = candidate)),
    });

    // A hand-rolled POST asserting an equity on a different exchange, with an
    // ISIN it made up. None of it may survive.
    const result = await selectInstrument(
      selectionOf({ instrumentKind: 'equity', exchange: 'LSE', isin: 'IE00B4L5Y983' }),
    );

    expect(result.ok).toBe(true);
    const instrument = result.ok ? result.value : undefined;
    expect(instrument?.kind).toBe('etf');
    expect(instrument?.exchange).toBe('AMS');
    expect(instrument?.currency).toBe(currency('EUR'));
    expect(instrument?.isin).toBeNull();

    // The candidate handed to the provider carries no client assertion either.
    expect(seen?.kind).toBeNull();
    expect(seen?.currency).toBeNull();
    expect(seen?.exchange).toBeNull();
    expect(seen?.isin).toBeNull();
  });

  it('saves the resolved symbol with the confirmed currency', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols,
      provider: providerReturning(CONFIRMED),
    });

    const result = await selectInstrument(selectionOf());

    expect(result.ok).toBe(true);
    const id = result.ok ? result.value.id : undefined;
    const resolved = await symbols.resolvedFor([id!]);
    expect(resolved.get(id!)?.symbol).toBe('IWDA.AS');
    expect(resolved.get(id!)?.currency).toBe(currency('EUR'));
  });

  it('persists nothing when confirm() refuses', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols,
      provider: providerReturning(null),
    });

    const result = await selectInstrument(selectionOf());

    expect(result.ok).toBe(false);
    expect(await instruments.listAll()).toHaveLength(0);
  });

  it('refuses a confirmation whose currency is null despite the narrowing', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    // `ConfirmedCandidate` narrows `currency` at compile time only, so an
    // adapter can satisfy it by assertion. The use case must not take it on
    // trust — this value would otherwise become the currency every later price
    // fetch is compared against.
    const liar = { ...CONFIRMED, currency: null as unknown as Currency } as ConfirmedCandidate;
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols,
      provider: providerReturning(liar),
    });

    const result = await selectInstrument(selectionOf());

    expect(result.ok).toBe(false);
    expect(await instruments.listAll()).toHaveLength(0);
  });

  it('refuses a confirmation whose kind is null despite the narrowing', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const liar = { ...CONFIRMED, kind: null } as unknown as ConfirmedCandidate;
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols,
      provider: providerReturning(liar),
    });

    const result = await selectInstrument(selectionOf());

    expect(result.ok).toBe(false);
    expect(await instruments.listAll()).toHaveLength(0);
  });

  it('rejects a selection that names no listing at all', async () => {
    const instruments = new InMemoryInstruments();
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols: new InMemorySymbols(),
      provider: providerReturning(CONFIRMED),
    });

    const result = await selectInstrument({ kind: 'candidate', provider: 'yahoo' });

    expect(result.ok).toBe(false);
    expect(await instruments.listAll()).toHaveLength(0);
  });

  it('returns an existing instrument by id without calling the provider', async () => {
    const instruments = new InMemoryInstruments();
    const existing = await instruments.findOrCreate({
      symbol: 'CDR',
      name: 'CD Projekt',
      kind: 'equity',
      currency: currency('PLN'),
      exchange: 'WSE',
    });
    let confirmCalls = 0;
    const selectInstrument = makeSelectInstrument({
      instruments,
      symbols: new InMemorySymbols(),
      provider: {
        name: 'yahoo',
        search: () => Promise.resolve([]),
        confirm: () => {
          confirmCalls += 1;
          return Promise.resolve(null);
        },
      },
    });

    const result = await selectInstrument({ kind: 'existing', instrumentId: existing.id });

    expect(result.ok && result.value.id).toBe(existing.id);
    expect(confirmCalls).toBe(0);
  });

  it('fails when the named existing instrument is gone', async () => {
    const selectInstrument = makeSelectInstrument({
      instruments: new InMemoryInstruments(),
      symbols: new InMemorySymbols(),
      provider: providerReturning(CONFIRMED),
    });

    const result = await selectInstrument({
      kind: 'existing',
      instrumentId: '00000000-0000-4000-9000-000000000999',
    });

    expect(result.ok).toBe(false);
  });
});
