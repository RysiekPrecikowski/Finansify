import Decimal from 'decimal.js';
import { currency, Money, Temporal, type ParsedRow, type TransactionType } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { reconcile } from './reconciliation';

const PLN = currency('PLN');

function row(
  ticker: string,
  type: TransactionType,
  quantity: number,
  externalId: string,
): ParsedRow {
  return {
    externalId,
    instrument: { symbol: ticker, exchange: null, name: null },
    type,
    tradeDate: Temporal.PlainDate.from('2024-03-01'),
    settleDate: null,
    quantity: new Decimal(quantity),
    price: Money.of(new Decimal(1), PLN),
    grossAmount: Money.of(new Decimal(quantity), PLN),
    fee: Money.zero(PLN),
    tax: Money.zero(PLN),
    currency: PLN,
    fxRate: null,
    fxRateSource: null,
    note: null,
    warnings: [],
  };
}

describe('reconcile', () => {
  it('adds no warning when the cash-derived net quantity matches Open Positions', () => {
    const rows = [row('ETFX.PL', 'buy', 10, 'T1'), row('ETFX.PL', 'sell', 3, 'T2')];

    const result = reconcile(rows, new Map([['ETFX.PL', new Decimal(7)]]), new Set());

    expect(result.rows.every((r) => r.warnings.length === 0)).toBe(true);
    expect(result.statementWarnings).toEqual([]);
  });

  it('returns the exact same array reference when nothing needs a warning', () => {
    const rows = [row('ETFX.PL', 'buy', 10, 'T1')];

    const result = reconcile(rows, new Map([['ETFX.PL', new Decimal(10)]]), new Set());

    expect(result.rows).toBe(rows);
  });

  it('attaches a mismatch warning to the last row for the ticker by array position, not the first', () => {
    const first = row('MISM.PL', 'buy', 10, 'T1');
    const last = row('MISM.PL', 'buy', 0, 'T2'); // quantity irrelevant to which row gets the warning

    const result = reconcile(
      [first, last],
      new Map([['MISM.PL', new Decimal(6)]]), // cash net is 10, statement says 6
      new Set(),
    );

    const byId = new Map(result.rows.map((r) => [r.externalId, r]));
    expect(byId.get('T1')?.warnings).toEqual([]);
    expect(byId.get('T2')?.warnings).toHaveLength(1);
    expect(byId.get('T2')?.warnings[0]).toMatch(/Reconciliation mismatch/);
  });

  it('does not attach the mismatch warning to every row for the ticker, only the last', () => {
    const rows = [row('MISM.PL', 'buy', 5, 'T1'), row('MISM.PL', 'buy', 5, 'T2')];

    const result = reconcile(rows, new Map([['MISM.PL', new Decimal(6)]]), new Set());

    const withWarnings = result.rows.filter((r) => r.warnings.length > 0);
    expect(withWarnings).toHaveLength(1);
    expect(withWarnings[0]?.externalId).toBe('T2');
  });

  it('adds a row-level warning when a nonzero cash-derived quantity has no counterpart anywhere', () => {
    const rows = [row('LOST.PL', 'buy', 5, 'T1')];

    const result = reconcile(rows, new Map(), new Set());

    expect(result.rows[0]?.warnings).toHaveLength(1);
    expect(result.rows[0]?.warnings[0]).toMatch(/no counterpart/);
    expect(result.statementWarnings).toEqual([]);
  });

  it('does not warn when the missing-counterpart ticker is at least present in Closed Positions', () => {
    const rows = [row('CLOSED.PL', 'buy', 5, 'T1')];

    const result = reconcile(rows, new Map(), new Set(['CLOSED.PL']));

    expect(result.rows[0]?.warnings).toEqual([]);
  });

  it('produces a statement-level warning, not a row warning, for a ticker in Open Positions with no cash rows at all', () => {
    const rows = [row('ETFX.PL', 'buy', 10, 'T1')];

    const result = reconcile(
      rows,
      new Map([
        ['ETFX.PL', new Decimal(10)],
        ['NOROWS.PL', new Decimal(3)],
      ]),
      new Set(),
    );

    expect(result.rows[0]?.warnings).toEqual([]);
    expect(result.statementWarnings).toHaveLength(1);
    expect(result.statementWarnings[0]).toContain('NOROWS.PL');
  });

  it('names spin-off as a likely cause of a ticker with no cash rows, not just "predates this export"', () => {
    // The old wording only mentioned the position predating the export's date
    // range, which is misleading for the real cause this most often has: a
    // spin-off (e.g. a company splitting in two) where the new ticker never
    // appears anywhere in Cash Operations because no cash ever moved for it.
    // A loose match, not an exact string — this is UI-facing prose, not a
    // contract — but a future rewrite that drops the spin-off framing
    // entirely should fail this test.
    const rows = [row('ETFX.PL', 'buy', 10, 'T1')];

    const result = reconcile(
      rows,
      new Map([
        ['ETFX.PL', new Decimal(10)],
        ['SPUN.PL', new Decimal(5)],
      ]),
      new Set(),
    );

    expect(result.statementWarnings).toHaveLength(1);
    expect(result.statementWarnings[0]).toContain('SPUN.PL');
    expect(result.statementWarnings[0]).toMatch(/spin-off/i);
  });

  it('ignores non-trade rows (e.g. dividend) when computing net quantity', () => {
    const dividendRow = row('ETFX.PL', 'dividend', 999, 'DIV1');

    const result = reconcile([dividendRow], new Map([['ETFX.PL', new Decimal(0)]]), new Set());

    // The dividend row's quantity must not be read as a position quantity —
    // with no buy/sell row for ETFX.PL, it falls into the "no cash rows"
    // statement-warning branch instead of matching cleanly.
    expect(result.statementWarnings).toHaveLength(1);
  });
});
