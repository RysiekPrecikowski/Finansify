import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { instrumentId } from '../ledger/types';
import { currency, Money } from '../money';
import { type ParsedRow } from '../ports/statement-parser';
import { Temporal } from '../time';

import { groupInstrumentCandidates } from './candidate-groups';
import { importBatchId, importRowId, type ImportRow } from './types';

const BATCH_ID = importBatchId('33333333-3333-4333-8333-333333333333');

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

function importRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    id: importRowId(`00000000-0000-4000-8000-${String(overrides.rowIndex ?? 0).padStart(12, '0')}`),
    batchId: BATCH_ID,
    rowIndex: 0,
    parsed: parsedRow(),
    status: 'pending',
    transactionId: null,
    rejectionReason: null,
    resolvedInstrumentId: null,
    ...overrides,
  };
}

describe('groupInstrumentCandidates', () => {
  it('collapses rows sharing the same (symbol, exchange) into one group with the right rowCount', () => {
    const rows = [
      importRow({ rowIndex: 0, parsed: parsedRow({ externalId: 'row-1' }) }),
      importRow({ rowIndex: 1, parsed: parsedRow({ externalId: 'row-2' }) }),
      importRow({ rowIndex: 2, parsed: parsedRow({ externalId: 'row-3' }) }),
    ];

    const groups = groupInstrumentCandidates(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ symbol: 'AAPL', exchange: null, rowCount: 3 });
  });

  it('keeps the same symbol on different exchanges as separate groups', () => {
    const rows = [
      importRow({
        rowIndex: 0,
        parsed: parsedRow({ instrument: { symbol: 'AAPL', exchange: 'NASDAQ', name: null } }),
      }),
      importRow({
        rowIndex: 1,
        parsed: parsedRow({ instrument: { symbol: 'AAPL', exchange: 'XETRA', name: null } }),
      }),
    ];

    const groups = groupInstrumentCandidates(rows);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.exchange).sort()).toEqual(['NASDAQ', 'XETRA']);
    expect(groups.every((group) => group.rowCount === 1)).toBe(true);
  });

  it('excludes rows whose parsed.instrument is null — a pure cash line contributes to no group', () => {
    const rows = [
      importRow({ rowIndex: 0, parsed: parsedRow({ instrument: null }) }),
      importRow({ rowIndex: 1, parsed: parsedRow() }),
    ];

    const groups = groupInstrumentCandidates(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.symbol).toBe('AAPL');
  });

  it("carries a resolved row's resolvedInstrumentId onto its group", () => {
    const id = instrumentId('44444444-4444-4444-8444-444444444444');
    const rows = [importRow({ rowIndex: 0, resolvedInstrumentId: id })];

    const groups = groupInstrumentCandidates(rows);

    expect(groups[0]!.resolvedInstrumentId).toBe(id);
  });

  it('leaves resolvedInstrumentId null for a group whose rows are not yet resolved', () => {
    const rows = [importRow({ rowIndex: 0 })];

    const groups = groupInstrumentCandidates(rows);

    expect(groups[0]!.resolvedInstrumentId).toBeNull();
  });

  it('returns no groups for an empty row list', () => {
    expect(groupInstrumentCandidates([])).toEqual([]);
  });
});
