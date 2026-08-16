import Decimal from 'decimal.js';
import { currency, Temporal } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { type CashOperationRow } from './cash-operations';
import { type MapContext, mapCashOperationRow, mapOpenPositionLot } from './map-operation';
import { type OpenPositionLot } from './positions';

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

  it('maps Dividend to dividend, carrying the normalized ticker as the instrument candidate', () => {
    const result = mapCashOperationRow(
      row({ type: 'Dividend', ticker: 'ETFX.PL', amount: new Decimal(12.34) }),
      ctx(),
    );

    expect(result?.type).toBe('dividend');
    // .PL is XTB's listing-country suffix, not the market symbol — normalized
    // to .WA (Warsaw) the same way instrumentOf normalizes every ticker.
    expect(result?.instrument).toEqual({ symbol: 'ETFX.WA', exchange: null, name: null });
    expect(result?.grossAmount?.toString()).toBe('12.34 PLN');
  });

  it('maps Withholding tax to tax, carrying the normalized ticker and stripping the sign', () => {
    const result = mapCashOperationRow(
      row({ type: 'Withholding tax', ticker: 'ETFX.PL', amount: new Decimal(-1.85) }),
      ctx(),
    );

    expect(result?.type).toBe('tax');
    expect(result?.instrument?.symbol).toBe('ETFX.WA');
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

describe('mapCashOperationRow — Fractional shares', () => {
  it('maps a positive amount to sell, quantity 0, with a warning that the quantity is unknown', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Fractional shares',
        ticker: 'SPLT.PL',
        amount: new Decimal(2.5),
        comment: 'SPLT.PL split 2 for 1',
      }),
      ctx(),
    );

    expect(result?.type).toBe('sell');
    expect(result?.quantity.toString()).toBe('0');
    expect(result?.grossAmount?.toString()).toBe('2.5 PLN');
    // Same ticker normalization every other row type goes through.
    expect(result?.instrument).toEqual({ symbol: 'SPLT.WA', exchange: null, name: null });
    expect(result?.warnings).toHaveLength(1);
    // Substance, not exact wording: names the row's own comment, and makes
    // clear the fractional quantity closed was not imported.
    expect(result?.warnings[0]).toContain('SPLT.PL split 2 for 1');
    expect(result?.warnings[0]).toMatch(/quantity|fraction/i);
  });

  it('maps a negative amount to buy, quantity 0', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Fractional shares',
        ticker: 'SPLT.PL',
        amount: new Decimal(-2.5),
        comment: 'SPLT.PL split 2 for 1',
      }),
      ctx(),
    );

    expect(result?.type).toBe('buy');
    expect(result?.quantity.toString()).toBe('0');
    expect(result?.grossAmount?.toString()).toBe('2.5 PLN');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toMatch(/quantity|fraction/i);
  });

  it('drops a zero-amount row, same as a zero-amount unrecognized row', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Fractional shares',
        ticker: 'SPLT.PL',
        amount: new Decimal(0),
        comment: 'SPLT.PL split 2 for 1',
      }),
      ctx(),
    );

    expect(result).toBeNull();
  });

  it('never falls through to the unrecognized-type dividend/fee-by-sign guess', () => {
    // Regression guard: before this type had its own case, it fell into
    // mapUnrecognized, which would produce 'dividend' here (positive amount)
    // — booking what is really a capital-gain sale as ordinary income.
    const result = mapCashOperationRow(
      row({
        type: 'Fractional shares',
        ticker: 'SPLT.PL',
        amount: new Decimal(2.5),
        comment: 'SPLT.PL split 2 for 1',
      }),
      ctx(),
    );

    expect(result?.type).not.toBe('dividend');
    expect(result?.warnings[0]).not.toMatch(/has no specific mapping/);
  });
});

describe('mapOpenPositionLot', () => {
  function lot(overrides: Partial<OpenPositionLot> = {}): OpenPositionLot {
    return {
      positionId: '1000000005',
      ticker: 'SPIN.WA',
      volume: new Decimal(8),
      openPrice: new Decimal('0.01'),
      openTime: Temporal.Instant.from('2024-08-01T08:00:00Z'),
      ...overrides,
    };
  }

  it('maps to transfer_in, never buy or sell — no evidence of an actual trade, only that a position exists', () => {
    const result = mapOpenPositionLot(lot(), PLN);

    expect(result.type).toBe('transfer_in');
  });

  it('builds externalId from the lot’s own position id, so a re-import dedups the same way every other row does', () => {
    const result = mapOpenPositionLot(lot({ positionId: '1000000005' }), PLN);

    expect(result.externalId).toBe('xtb-position:1000000005');
  });

  it('carries the lot’s ticker onto the instrument candidate as-is, without re-normalizing it', () => {
    const result = mapOpenPositionLot(lot({ ticker: 'SPIN.WA' }), PLN);

    expect(result.instrument).toEqual({ symbol: 'SPIN.WA', exchange: null, name: null });
  });

  it('sets quantity to the lot’s volume', () => {
    const result = mapOpenPositionLot(lot({ volume: new Decimal('8') }), PLN);

    expect(result.quantity.toString()).toBe('8');
  });

  it('sets price to the lot’s open price, and grossAmount to open price × volume', () => {
    const result = mapOpenPositionLot(
      lot({ volume: new Decimal('8'), openPrice: new Decimal('0.01') }),
      PLN,
    );

    expect(result.price?.toString()).toBe('0.01 PLN');
    expect(result.grossAmount?.toString()).toBe('0.08 PLN');
  });

  it('uses the passed-in currency for price, grossAmount, fee and tax', () => {
    const USD = currency('USD');
    const result = mapOpenPositionLot(lot(), USD);

    expect(result.price?.toString()).toBe('0.01 USD');
    expect(result.grossAmount?.toString()).toBe('0.08 USD');
    expect(result.fee.toString()).toBe('0 USD');
    expect(result.tax.toString()).toBe('0 USD');
    expect(result.currency).toBe(USD);
  });

  it('derives tradeDate from the lot’s open time, converted to the investor’s own Warsaw day', () => {
    const result = mapOpenPositionLot(
      lot({ openTime: Temporal.Instant.from('2024-08-01T08:00:00Z') }),
      PLN,
    );

    expect(result.tradeDate.toString()).toBe('2024-08-01');
  });

  it('leaves fxRate, fxRateSource, settleDate and note null', () => {
    const result = mapOpenPositionLot(lot(), PLN);

    expect(result.fxRate).toBeNull();
    expect(result.fxRateSource).toBeNull();
    expect(result.settleDate).toBeNull();
    expect(result.note).toBeNull();
  });

  it('carries exactly one warning explaining the row was recovered from Open Positions and should be reviewed', () => {
    const result = mapOpenPositionLot(lot(), PLN);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Open Positions/);
    expect(result.warnings[0]).toMatch(/Cash Operations/);
    expect(result.warnings[0]).toMatch(/review/i);
  });
});

describe('mapCashOperationRow — unrecognized types', () => {
  it('falls back to dividend for a positive amount, with a warning naming the type and comment', () => {
    const result = mapCashOperationRow(
      row({
        type: 'Some Future Type',
        ticker: 'ETFX.PL',
        amount: new Decimal(2.5),
        comment: 'a type this parser has never seen',
      }),
      ctx(),
    );

    expect(result?.type).toBe('dividend');
    expect(result?.grossAmount?.toString()).toBe('2.5 PLN');
    expect(result?.instrument?.symbol).toBe('ETFX.WA');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toContain('Some Future Type');
    expect(result?.warnings[0]).toContain('a type this parser has never seen');
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
