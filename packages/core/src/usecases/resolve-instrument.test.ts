import { describe, expect, it } from 'vitest';

import { instrumentId, type Instrument, type InstrumentId } from '../ledger';
import { type InstrumentInput, type InstrumentRepository } from '../ledger/ports';
import { makeResolveInstrument } from './resolve-instrument';
import { type FieldIssue } from './result';

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

/**
 * Minimal fake of the real `packages/db` adapter's dedup rule: one row per
 * `(symbol, exchange)`, where a `null` exchange is its own bucket rather than
 * a wildcard — mirrors `eqOrNull` in `packages/db/src/ledger-repository.ts`.
 */
class InMemoryInstruments implements InstrumentRepository {
  private readonly rows: Instrument[] = [];
  private sequence = 0;

  private nextId(): InstrumentId {
    this.sequence += 1;
    return instrumentId(`00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`);
  }

  findOrCreate(input: InstrumentInput): Promise<Instrument> {
    const exchange = input.exchange ?? null;
    const existing = this.rows.find(
      (row) => row.symbol === input.symbol && row.exchange === exchange,
    );
    if (existing !== undefined) return Promise.resolve(existing);

    const instrument: Instrument = {
      id: this.nextId(),
      kind: input.kind,
      isin: input.isin ?? null,
      symbol: input.symbol,
      exchange,
      currency: input.currency,
      name: input.name,
    };
    this.rows.push(instrument);
    return Promise.resolve(instrument);
  }

  listAll(): Promise<readonly Instrument[]> {
    return Promise.resolve([...this.rows]);
  }
}

const validInput = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  kind: 'equity',
  currency: 'USD',
};

describe('makeResolveInstrument', () => {
  it('creates and returns an instrument for a new symbol', async () => {
    const instruments = new InMemoryInstruments();
    const resolveInstrument = makeResolveInstrument({ instruments });

    const result = await resolveInstrument(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.symbol).toBe('AAPL');
    expect(await instruments.listAll()).toHaveLength(1);
  });

  it('creates once for the same symbol submitted twice, returning the same id both times', async () => {
    const instruments = new InMemoryInstruments();
    const resolveInstrument = makeResolveInstrument({ instruments });

    const first = await resolveInstrument(validInput);
    const second = await resolveInstrument(validInput);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.id).toBe(first.value.id);
    expect(await instruments.listAll()).toHaveLength(1);
  });

  it('stores a lower-case symbol upper-cased', async () => {
    const instruments = new InMemoryInstruments();
    const resolveInstrument = makeResolveInstrument({ instruments });

    const result = await resolveInstrument({ ...validInput, symbol: 'aapl' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.symbol).toBe('AAPL');
  });

  it('rejects an ISIN that is not exactly 12 characters', async () => {
    const instruments = new InMemoryInstruments();
    const resolveInstrument = makeResolveInstrument({ instruments });

    const result = await resolveInstrument({ ...validInput, isin: 'US012' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'isin')).toBeDefined();
    expect(await instruments.listAll()).toHaveLength(0);
  });
});
