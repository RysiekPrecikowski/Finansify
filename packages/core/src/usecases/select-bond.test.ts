import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { resolveFamilyRules } from '../bonds/families';
import { type BondTermsResolver } from '../bonds/ports';
import { parseSeriesCode } from '../bonds/series-code';
import { type BondSeriesCode, type BondTerms } from '../bonds/types';
import { type InstrumentInput, type InstrumentRepository } from '../ledger/ports';
import { instrumentId, type Instrument } from '../ledger/types';
import { currency as toCurrency } from '../money';
import { looksLikeSeriesCode, makeSelectBond } from './select-bond';

const PLN = toCurrency('PLN');

function fakeInstruments() {
  const created: InstrumentInput[] = [];
  const instruments: InstrumentRepository = {
    async findById() {
      return null;
    },
    async search() {
      return [];
    },
    async listAll() {
      return [];
    },
    async findOrCreate(input) {
      created.push(input);
      return { id: instrumentId('44444444-4444-4444-8444-444444444444'), ...input } as Instrument;
    },
  };
  return { instruments, created };
}

function fakeResolver(answer: 'resolves' | 'unresolvable') {
  const calls: { code: BondSeriesCode; on: string }[] = [];
  const resolver: BondTermsResolver = {
    async resolve(code, purchasedOn) {
      calls.push({ code, on: purchasedOn.toString() });
      if (answer === 'unresolvable') return null;
      const parsed = parseSeriesCode(code);
      return {
        seriesCode: parsed.code,
        rules: resolveFamilyRules(parsed.family, purchasedOn),
        firstPeriodRate: new Decimal('0.0535'),
        margin: new Decimal('0.02'),
      } satisfies BondTerms;
    },
  };
  return { resolver, calls };
}

describe('makeSelectBond', () => {
  it('creates a PLN bond instrument keyed by its series code', async () => {
    const { instruments, created } = fakeInstruments();
    const { resolver } = fakeResolver('resolves');

    const result = await makeSelectBond({ instruments, resolver })({
      seriesCode: 'EDO0836',
      settledOn: '2026-08-01',
    });

    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      symbol: 'EDO0836',
      kind: 'bond',
      currency: PLN,
      // Not listed anywhere, so no exchange and no provider symbol — the code
      // is the identity, unique by construction.
      exchange: null,
      isin: null,
    });
  });

  it('normalizes the code before using it', async () => {
    const { instruments, created } = fakeInstruments();
    const { resolver } = fakeResolver('resolves');

    await makeSelectBond({ instruments, resolver })({
      seriesCode: '  edo0836 ',
      settledOn: '2026-08-01',
    });

    expect(created[0]?.symbol).toBe('EDO0836');
  });

  it('resolves the terms against the settlement date, since that picks the rules', async () => {
    const { instruments } = fakeInstruments();
    const { resolver, calls } = fakeResolver('resolves');

    await makeSelectBond({ instruments, resolver })({
      seriesCode: 'EDO0836',
      settledOn: '2024-08-31',
    });

    expect(calls).toEqual([{ code: 'EDO0836', on: '2024-08-31' }]);
  });

  it('refuses a series whose terms will not resolve, rather than saving it', async () => {
    // The equivalent of ADR 0014's confirm() gate: no provider quotes these, so
    // resolvability is what stands in for it. An unresolvable series must not
    // become a row nothing can ever value.
    const { instruments, created } = fakeInstruments();
    const { resolver } = fakeResolver('unresolvable');

    const result = await makeSelectBond({ instruments, resolver })({
      seriesCode: 'EDO0125',
      settledOn: '2015-01-01',
    });

    expect(result.ok).toBe(false);
    expect(created, 'nothing may be persisted when the terms do not resolve').toEqual([]);
  });

  it.each(['DOS0817', 'XXX0836'])('refuses %s — a family with no rules', async (code) => {
    const { instruments, created } = fakeInstruments();
    const { resolver } = fakeResolver('resolves');

    const result = await makeSelectBond({ instruments, resolver })({
      seriesCode: code,
      settledOn: '2026-08-01',
    });

    expect(result.ok).toBe(false);
    expect(created).toEqual([]);
  });

  it.each(['EDO083', 'not-a-code', '', 'EDO08366'])('rejects %s as malformed', async (code) => {
    const { instruments } = fakeInstruments();
    const { resolver } = fakeResolver('resolves');

    const result = await makeSelectBond({ instruments, resolver })({
      seriesCode: code,
      settledOn: '2026-08-01',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a settlement date that is not a date', async () => {
    const { instruments } = fakeInstruments();
    const { resolver } = fakeResolver('resolves');

    const result = await makeSelectBond({ instruments, resolver })({
      seriesCode: 'EDO0836',
      settledOn: '2026-02-31',
    });

    expect(result.ok).toBe(false);
  });
});

describe('looksLikeSeriesCode', () => {
  it.each(['EDO0836', 'edo0836', ' ROR0827 '])('accepts %s', (query) => {
    expect(looksLikeSeriesCode(query)).toBe(true);
  });

  it.each(['EDO', 'VOO', '0836', 'EDO08366', 'Apple Inc'])('rejects %s', (query) => {
    expect(looksLikeSeriesCode(query)).toBe(false);
  });
});
