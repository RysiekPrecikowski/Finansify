import { describe, expect, it } from 'vitest';

import { instrumentId, type Instrument } from '../ledger/types';
import { currency } from '../money';
import { InMemorySymbols } from './in-memory-valuation';
import { makeMapInstrument } from './map-instrument';
import { type SymbolResolver } from './ports';

const SXR8 = instrumentId('00000000-0000-4000-9000-000000000010');

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: SXR8,
    kind: 'etf',
    isin: 'IE00B5BMR087',
    symbol: 'SXR8',
    exchange: 'XETR',
    currency: currency('EUR'),
    name: 'iShares Core S&P 500',
    ...overrides,
  };
}

describe('makeMapInstrument', () => {
  it('saves the symbol the resolver returns', async () => {
    const symbols = new InMemorySymbols();
    const resolver: SymbolResolver = {
      name: 'yahoo',
      resolve: (instr) =>
        Promise.resolve({
          instrumentId: instr.id,
          provider: 'yahoo',
          symbol: 'SXR8.DE',
          currency: instr.currency,
        }),
    };

    const mapInstrument = makeMapInstrument({ symbols, resolver });
    const result = await mapInstrument(instrument());

    expect(result?.symbol).toBe('SXR8.DE');
    const stored = await symbols.resolvedFor([SXR8]);
    expect(stored.get(SXR8)?.symbol).toBe('SXR8.DE');
  });

  it('returns null and saves nothing when the resolver refuses', async () => {
    const symbols = new InMemorySymbols();
    const resolver: SymbolResolver = { name: 'yahoo', resolve: () => Promise.resolve(null) };

    const mapInstrument = makeMapInstrument({ symbols, resolver });
    const result = await mapInstrument(instrument());

    expect(result).toBeNull();
    expect((await symbols.resolvedFor([SXR8])).size).toBe(0);
  });

  it('never re-resolves an instrument that already has a saved mapping', async () => {
    const symbols = new InMemorySymbols();
    await symbols.save({
      instrumentId: SXR8,
      provider: 'yahoo',
      symbol: 'SXR8.DE',
      currency: currency('EUR'),
    });
    let calls = 0;
    const resolver: SymbolResolver = {
      name: 'yahoo',
      resolve: () => {
        calls += 1;
        return Promise.resolve(null);
      },
    };

    const mapInstrument = makeMapInstrument({ symbols, resolver });
    const result = await mapInstrument(instrument());

    expect(calls).toBe(0);
    expect(result?.symbol).toBe('SXR8.DE');
  });
});
