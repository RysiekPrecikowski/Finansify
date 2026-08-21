import { describe, expect, it } from 'vitest';

import { InMemoryInstruments } from '../ledger/in-memory-ledger';
import { instrumentId } from '../ledger/types';
import { currency } from '../money';
import { InMemorySymbols } from '../valuation/in-memory-valuation';
import { makeSetInstrumentChain } from './set-instrument-chain';

async function seededInstrument(instruments: InMemoryInstruments, symbols: InMemorySymbols) {
  const instrument = await instruments.findOrCreate({
    symbol: 'PKN',
    name: 'PKN Orlen',
    kind: 'equity',
    currency: currency('PLN'),
    isin: 'PLPKN0000018',
    exchange: 'WSE',
  });
  // `setChain` needs to already know the instrument's currency/kind — this
  // fake carries them per row rather than joining `instruments` the way
  // production does, so one `save()` establishes them (see
  // `InMemorySymbols.setChain`'s own doc comment).
  await symbols.save({
    instrumentId: instrument.id,
    provider: 'yahoo',
    symbol: 'PKN.WA',
    currency: currency('PLN'),
    kind: 'equity',
  });
  return instrument;
}

describe('makeSetInstrumentChain', () => {
  it('replaces the chain, ordered exactly as submitted', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const instrument = await seededInstrument(instruments, symbols);
    const setInstrumentChain = makeSetInstrumentChain({ instruments, symbols });

    const result = await setInstrumentChain({
      instrumentId: instrument.id,
      entries: [
        { provider: 'gpw', symbol: 'PLPKN0000018' },
        { provider: 'yahoo', symbol: 'PKN.WA' },
      ],
    });

    expect(result.ok).toBe(true);
    const chain = (await symbols.chainFor([instrument.id])).get(instrument.id);
    expect(chain?.map((entry) => entry.provider)).toEqual(['gpw', 'yahoo']);
    expect(chain?.map((entry) => entry.priority)).toEqual([0, 1]);
  });

  it('leaves the instrument unmapped when submitted with no entries', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const instrument = await seededInstrument(instruments, symbols);
    const setInstrumentChain = makeSetInstrumentChain({ instruments, symbols });

    const result = await setInstrumentChain({ instrumentId: instrument.id, entries: [] });

    expect(result.ok).toBe(true);
    expect((await symbols.chainFor([instrument.id])).get(instrument.id)).toBeUndefined();
  });

  it('rejects a chain that names the same provider twice', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const instrument = await seededInstrument(instruments, symbols);
    const setInstrumentChain = makeSetInstrumentChain({ instruments, symbols });

    const result = await setInstrumentChain({
      instrumentId: instrument.id,
      entries: [
        { provider: 'gpw', symbol: 'PLPKN0000018' },
        { provider: 'gpw', symbol: 'SOMETHING-ELSE' },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues.some((issue) => issue.path === 'entries')).toBe(true);
  });

  it('rejects an instrument id that no longer exists', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const setInstrumentChain = makeSetInstrumentChain({ instruments, symbols });

    const result = await setInstrumentChain({
      instrumentId: instrumentId('00000000-0000-4000-9000-000000000099'),
      entries: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues[0]?.path).toBe('instrumentId');
  });

  it('rejects an unknown provider name', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const instrument = await seededInstrument(instruments, symbols);
    const setInstrumentChain = makeSetInstrumentChain({ instruments, symbols });

    const result = await setInstrumentChain({
      instrumentId: instrument.id,
      entries: [{ provider: 'stooq', symbol: 'PKN' }],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a blank symbol', async () => {
    const instruments = new InMemoryInstruments();
    const symbols = new InMemorySymbols();
    const instrument = await seededInstrument(instruments, symbols);
    const setInstrumentChain = makeSetInstrumentChain({ instruments, symbols });

    const result = await setInstrumentChain({
      instrumentId: instrument.id,
      entries: [{ provider: 'gpw', symbol: '   ' }],
    });

    expect(result.ok).toBe(false);
  });
});
