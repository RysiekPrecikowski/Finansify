import { describe, expect, it } from 'vitest';

import { InMemoryInstruments } from '../ledger/in-memory-ledger';
import { makeResolveInstrument } from './resolve-instrument';
import { type FieldIssue } from './result';

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
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
