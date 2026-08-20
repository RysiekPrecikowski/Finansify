import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { InMemoryImports } from '../imports/in-memory-imports';
import { type CreateImportBatchInput } from '../imports';
import { InMemoryInstruments } from '../ledger/in-memory-ledger';
import { type InstrumentInput, type InstrumentRepository } from '../ledger/ports';
import { accountId, type Instrument } from '../ledger/types';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { type ParsedRow } from '../ports/statement-parser';
import { Temporal } from '../time';

import { makeMatchImportInstruments } from './match-import-instruments';

const USER = userId('11111111-1111-4111-8111-111111111111');

const BATCH_INPUT: CreateImportBatchInput = {
  accountId: accountId('22222222-2222-4222-8222-222222222222'),
  broker: 'xtb',
  blobKey: 'imports/22222222-2222-4222-8222-222222222222/1700000000000-statement.csv',
};

function parsedRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    externalId: 'row-1',
    instrument: { symbol: 'AAPL', exchange: null, name: 'Apple Inc.' },
    type: 'buy',
    tradeDate: Temporal.PlainDate.from('2024-01-10'),
    settleDate: null,
    quantity: new Decimal('10'),
    price: Money.of('100', currency('PLN')),
    grossAmount: null,
    fee: Money.of('0', currency('PLN')),
    tax: Money.of('0', currency('PLN')),
    currency: currency('PLN'),
    fxRate: null,
    fxRateSource: null,
    note: null,
    warnings: [],
    ...overrides,
  };
}

async function seedBatch(imports: InMemoryImports, rows: readonly ParsedRow[]) {
  const scoped = imports.forUser(USER);
  const batch = await scoped.createBatch(BATCH_INPUT);
  await scoped.createRows(batch.id, rows);
  return batch;
}

async function seedInstrument(
  instruments: InstrumentRepository,
  input: Partial<InstrumentInput> = {},
): Promise<Instrument> {
  return instruments.findOrCreate({
    symbol: 'AAPL',
    name: 'Apple Inc.',
    kind: 'equity',
    currency: currency('PLN'),
    ...input,
  });
}

/**
 * Counts calls to the wrapped fake's `search`, to prove an already-resolved
 * group is skipped rather than merely ignored. Forwards every method
 * explicitly rather than spreading `instruments` — the fake's methods live on
 * its prototype, so a spread would silently drop everything but `search`.
 */
function countingSearch(instruments: InstrumentRepository): {
  repo: InstrumentRepository;
  calls: () => number;
} {
  let calls = 0;
  const repo: InstrumentRepository = {
    findOrCreate: (input) => instruments.findOrCreate(input),
    findById: (id) => instruments.findById(id),
    listAll: () => instruments.listAll(),
    search: (query) => {
      calls += 1;
      return instruments.search(query);
    },
  };
  return { repo, calls: () => calls };
}

describe('makeMatchImportInstruments', () => {
  it('returns a failure result for an invalid batchId, without touching the repository', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments('not-a-uuid');

    expect(result.ok).toBe(false);
  });

  it('sets suggested for an unresolved group with exactly one exact local symbol match', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const instrument = await seedInstrument(instruments);
    const batch = await seedBatch(imports, [parsedRow()]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.suggested).toEqual(instrument);
  });

  it('matches case-insensitively on symbol', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const instrument = await seedInstrument(instruments, { symbol: 'aapl' });
    const batch = await seedBatch(imports, [
      parsedRow({ instrument: { symbol: 'AAPL', exchange: null, name: null } }),
    ]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toEqual(instrument);
  });

  it('requires the exchange to match too when the group has one', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    await seedInstrument(instruments, { exchange: 'XETRA' });
    const batch = await seedBatch(imports, [
      parsedRow({ instrument: { symbol: 'AAPL', exchange: 'NASDAQ', name: null } }),
    ]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toBeNull();
  });

  it('leaves suggested null when there is no local match', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const batch = await seedBatch(imports, [parsedRow()]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toBeNull();
  });

  it('leaves suggested null when the local match is ambiguous (2+ hits)', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    await seedInstrument(instruments, { exchange: 'NASDAQ' });
    await seedInstrument(instruments, { exchange: 'XETRA' });
    const batch = await seedBatch(imports, [
      parsedRow({ instrument: { symbol: 'AAPL', exchange: null, name: null } }),
    ]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toBeNull();
  });

  it('gives an already-resolved group suggested: null and never calls search for it', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const instrument = await seedInstrument(instruments);
    const batch = await seedBatch(imports, [parsedRow()]);
    await imports
      .forUser(USER)
      .resolveInstruments(batch.id, [
        { symbol: 'AAPL', exchange: null, instrumentId: instrument.id },
      ]);
    const { repo: countedInstruments, calls } = countingSearch(instruments);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments: countedInstruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.suggested).toBeNull();
    expect(result.value[0]!.resolvedInstrumentId).toBe(instrument.id);
    expect(calls()).toBe(0);
  });

  it('resolves a batch with mixed groups independently — resolved groups skip search, unresolved ones still get matched', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const apple = await seedInstrument(instruments);
    const batch = await seedBatch(imports, [
      parsedRow({
        externalId: 'row-1',
        instrument: { symbol: 'AAPL', exchange: null, name: null },
      }),
      parsedRow({
        externalId: 'row-2',
        instrument: { symbol: 'MSFT', exchange: null, name: null },
      }),
    ]);
    await imports
      .forUser(USER)
      .resolveInstruments(batch.id, [{ symbol: 'AAPL', exchange: null, instrumentId: apple.id }]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bySymbol = new Map(result.value.map((group) => [group.symbol, group]));
    expect(bySymbol.get('AAPL')!.suggested).toBeNull();
    expect(bySymbol.get('AAPL')!.resolvedInstrumentId).toBe(apple.id);
    expect(bySymbol.get('MSFT')!.suggested).toBeNull();
  });

  it('matches on ISIN even when the symbol the broker used differs from ours', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const instrument = await seedInstrument(instruments, {
      symbol: 'AAPL',
      isin: 'US0378331005',
    });
    const batch = await seedBatch(imports, [
      parsedRow({
        instrument: { symbol: 'APPLE-US', exchange: null, name: null, isin: 'US0378331005' },
      }),
    ]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toEqual(instrument);
  });

  it('falls back to the symbol/exchange match when the ISIN matches nothing locally', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const instrument = await seedInstrument(instruments, { symbol: 'AAPL', isin: null });
    const batch = await seedBatch(imports, [
      parsedRow({
        instrument: { symbol: 'AAPL', exchange: null, name: null, isin: 'US0378331005' },
      }),
    ]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toEqual(instrument);
  });

  it('falls back to the symbol/exchange match when the ISIN hits more than one local instrument', async () => {
    const imports = new InMemoryImports();
    const instruments = new InMemoryInstruments();
    const instrument = await seedInstrument(instruments, {
      symbol: 'AAPL',
      exchange: null,
      isin: 'US0378331005',
    });
    await seedInstrument(instruments, {
      symbol: 'AAPL-DUP',
      exchange: 'XETRA',
      isin: 'US0378331005',
    });
    const batch = await seedBatch(imports, [
      parsedRow({
        instrument: { symbol: 'AAPL', exchange: null, name: null, isin: 'US0378331005' },
      }),
    ]);
    const matchImportInstruments = makeMatchImportInstruments({
      imports: imports.forUser(USER),
      instruments,
    });

    const result = await matchImportInstruments(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.suggested).toEqual(instrument);
  });
});
