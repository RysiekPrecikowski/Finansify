import Decimal from 'decimal.js';
import { currency, Temporal } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { type CashOperationRow } from './cash-operations';
import { type MapContext, mapCashOperationRow } from './map-operation';

const PLN = currency('PLN');

function row(
  overrides: Partial<CashOperationRow> & Pick<CashOperationRow, 'type'>,
): CashOperationRow {
  return {
    ticker: null,
    time: Temporal.Instant.from('2024-03-01T08:00:00Z'),
    amount: new Decimal(0),
    id: 'X1',
    comment: '',
    ...overrides,
  };
}

function ctx(fxRatioByTicker: ReadonlyMap<string, Decimal | null> = new Map()): MapContext {
  return { accountCurrency: PLN, fxRatioByTicker };
}

describe('mapCashOperationRow — plain cash types', () => {
  it('maps Deposit to deposit with the absolute amount', () => {
    const result = mapCashOperationRow(row({ type: 'Deposit', amount: new Decimal(5000) }), ctx());

    expect(result?.type).toBe('deposit');
    expect(result?.grossAmount?.toString()).toBe('5000 PLN');
    expect(result?.warnings).toEqual([]);
  });

  it('maps Withdrawal to withdrawal, stripping the negative sign', () => {
    const result = mapCashOperationRow(
      row({ type: 'Withdrawal', amount: new Decimal(-500) }),
      ctx(),
    );

    expect(result?.type).toBe('withdrawal');
    expect(result?.grossAmount?.toString()).toBe('500 PLN');
  });

  it('maps Free funds interest to interest', () => {
    const result = mapCashOperationRow(
      row({ type: 'Free funds interest', amount: new Decimal(3.2) }),
      ctx(),
    );

    expect(result?.type).toBe('interest');
    expect(result?.grossAmount?.toString()).toBe('3.2 PLN');
  });

  it('maps Free funds interest tax to tax, stripping the negative sign', () => {
    const result = mapCashOperationRow(
      row({ type: 'Free funds interest tax', amount: new Decimal(-0.61) }),
      ctx(),
    );

    expect(result?.type).toBe('tax');
    expect(result?.grossAmount?.toString()).toBe('0.61 PLN');
  });

  it('maps Dividend to dividend, carrying the ticker as the instrument candidate', () => {
    const result = mapCashOperationRow(
      row({ type: 'Dividend', ticker: 'ETFX.PL', amount: new Decimal(12.34) }),
      ctx(),
    );

    expect(result?.type).toBe('dividend');
    expect(result?.instrument).toEqual({ symbol: 'ETFX.PL', exchange: null, name: null });
    expect(result?.grossAmount?.toString()).toBe('12.34 PLN');
  });

  it('maps Withholding tax to tax, carrying the ticker and stripping the sign', () => {
    const result = mapCashOperationRow(
      row({ type: 'Withholding tax', ticker: 'ETFX.PL', amount: new Decimal(-1.85) }),
      ctx(),
    );

    expect(result?.type).toBe('tax');
    expect(result?.instrument?.symbol).toBe('ETFX.PL');
    expect(result?.grossAmount?.toString()).toBe('1.85 PLN');
  });
});

describe('mapCashOperationRow — trades', () => {
  it('derives price as grossAmount ÷ quantity, not the comment’s own @price, when no FX applies', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Stock purchase',
        ticker: 'ETFX.PL',
        amount: new Decimal(-500),
        comment: 'OPEN BUY 10 @ 50.00',
      }),
      ctx(),
    );

    expect(result?.type).toBe('buy');
    expect(result?.quantity.toString()).toBe('10');
    expect(result?.price?.toString()).toBe('50 PLN');
    expect(result?.fxRate).toBeNull();
    expect(result?.fxRateSource).toBeNull();
    expect(result?.warnings).toEqual([]);
  });

  it('derives price from grossAmount ÷ quantity even when it disagrees with the comment’s own @price under FX', () => {
    // Comment says "@ 100.00" but the account-currency amount (-276) over the
    // quantity (3) gives 92 — the FX ratio (0.92) is exactly what separates
    // the two. Asserting 92, not 100, proves the code does not just copy the
    // comment's price through.
    const result = mapCashOperationRow(
      row({
        type: 'Stock purchase',
        ticker: 'FORX.US',
        amount: new Decimal(-276),
        comment: 'OPEN BUY 3 @ 100.00',
      }),
      ctx(new Map([['FORX.US', new Decimal(0.92)]])),
    );

    expect(result?.quantity.toString()).toBe('3');
    expect(result?.price?.toString()).toBe('92 PLN');
    expect(result?.price?.toString()).not.toBe('100 PLN');
    expect(result?.fxRate?.toString()).toBe('0.92');
    expect(result?.fxRateSource).toBe('broker');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toMatch(/FX/);
  });

  it('maps Stock sell to sell', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Stock sell',
        ticker: 'ETFX.PL',
        amount: new Decimal(165),
        comment: 'CLOSE BUY 3 @ 55.00',
      }),
      ctx(),
    );

    expect(result?.type).toBe('sell');
    expect(result?.quantity.toString()).toBe('3');
    expect(result?.price?.toString()).toBe('55 PLN');
  });

  it('still returns a cash-only row (not null, not a throw) when the comment does not parse', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Stock purchase',
        ticker: 'ETFX.PL',
        amount: new Decimal(-500),
        comment: 'not a trade comment at all',
      }),
      ctx(),
    );

    expect(result).not.toBeNull();
    expect(result?.type).toBe('buy');
    expect(result?.quantity.toString()).toBe('0');
    expect(result?.price).toBeNull();
    expect(result?.grossAmount?.toString()).toBe('500 PLN');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toMatch(/Could not parse the trade comment/);
  });
});

describe('mapCashOperationRow — zero-sum transfers', () => {
  it('returns null for Subaccount transfer', () => {
    expect(
      mapCashOperationRow(row({ type: 'Subaccount transfer', amount: new Decimal(1000) }), ctx()),
    ).toBeNull();
  });

  it('returns null for Transfer', () => {
    expect(
      mapCashOperationRow(row({ type: 'Transfer', amount: new Decimal(-300) }), ctx()),
    ).toBeNull();
  });
});

describe('mapCashOperationRow — unrecognized types', () => {
  it('falls back to dividend for a positive amount, with a warning naming the type and comment', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Fractional shares',
        ticker: 'SPLT.PL',
        amount: new Decimal(2.5),
        comment: 'SPLT.PL split 2 for 1',
      }),
      ctx(),
    );

    expect(result?.type).toBe('dividend');
    expect(result?.grossAmount?.toString()).toBe('2.5 PLN');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toContain('Fractional shares');
    expect(result?.warnings[0]).toContain('SPLT.PL split 2 for 1');
  });

  it('falls back to fee for a negative amount', () => {
    const result = mapCashOperationRow(
      row({ type: 'Some Future Type', amount: new Decimal(-10), comment: 'unknown' }),
      ctx(),
    );

    expect(result?.type).toBe('fee');
    expect(result?.grossAmount?.toString()).toBe('10 PLN');
    expect(result?.warnings[0]).toContain('Some Future Type');
  });

  it('returns null for an unrecognized type with a zero amount', () => {
    expect(
      mapCashOperationRow(row({ type: 'Commission', amount: new Decimal(0) }), ctx()),
    ).toBeNull();
  });
});
