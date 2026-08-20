import Decimal from 'decimal.js';
import { currency, Temporal } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { type BosRow } from './csv-rows';
import { mapBosRow } from './map-operation';

function row(overrides: Partial<BosRow> = {}): BosRow {
  return {
    date: Temporal.PlainDate.from('2026-01-05'),
    title: 'Przelew do DM BOŚ',
    details: '',
    amount: new Decimal(5000),
    currency: currency('PLN'),
    lineIndex: 0,
    ...overrides,
  };
}

describe('mapBosRow — deposit', () => {
  it('maps "Przelew do DM BOŚ" to deposit with the absolute amount and no instrument', () => {
    const result = mapBosRow(row({ amount: new Decimal(5000) }), 'id-1');

    expect(result?.type).toBe('deposit');
    expect(result?.instrument).toBeNull();
    expect(result?.grossAmount?.toString()).toBe('5000 PLN');
    expect(result?.quantity.toString()).toBe('0');
    expect(result?.fee.toString()).toBe('0 PLN');
    expect(result?.tax.toString()).toBe('0 PLN');
    expect(result?.warnings).toEqual([]);
  });

  it('carries the externalId through unchanged', () => {
    const result = mapBosRow(row(), 'bos:some-key 0');

    expect(result?.externalId).toBe('bos:some-key 0');
  });
});

describe('mapBosRow — buy', () => {
  const BUY_TITLE = 'Rozliczenie transakcji kupna:';

  it('parses a clean buy whose settled amount equals quantity × price exactly — no commission warning', () => {
    const result = mapBosRow(
      row({
        title: BUY_TITLE,
        details: 'Vanguard FTSE All-World UCITS ETF (IE00B3RBWM25) 10 x 100.00 EUR nr Z00000000001',
        amount: new Decimal(-1000),
        currency: currency('EUR'),
      }),
      'id-2',
    );

    expect(result?.type).toBe('buy');
    expect(result?.quantity.toString()).toBe('10');
    expect(result?.price?.toString()).toBe('100 EUR');
    expect(result?.grossAmount?.toString()).toBe('1000 EUR');
    expect(result?.fee.toString()).toBe('0 EUR');
    expect(result?.instrument).toEqual({
      symbol: 'Vanguard FTSE All-World UCITS ETF',
      exchange: null,
      name: 'Vanguard FTSE All-World UCITS ETF',
      isin: 'IE00B3RBWM25',
    });
    expect(result?.warnings).toEqual([]);
  });

  it('emits an implied-commission warning when the settled amount differs from quantity × price', () => {
    const result = mapBosRow(
      row({
        title: BUY_TITLE,
        details: 'Vanguard FTSE All-World UCITS ETF (IE00B3RBWM25) 5 x 100.00 EUR nr Z00000000002',
        amount: new Decimal(-502.5),
        currency: currency('EUR'),
      }),
      'id-3',
    );

    expect(result?.type).toBe('buy');
    expect(result?.quantity.toString()).toBe('5');
    expect(result?.grossAmount?.toString()).toBe('502.5 EUR');
    // fee stays zero — the export never breaks the commission out separately.
    expect(result?.fee.toString()).toBe('0 EUR');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toMatch(/commission/i);
    expect(result?.warnings[0]).toContain('2.5');
  });

  it('falls back to a cash-only buy with a warning when szczegóły does not parse', () => {
    const result = mapBosRow(
      row({
        title: BUY_TITLE,
        details: 'coś nietypowego, nie pasuje do wzorca',
        amount: new Decimal(-100),
        currency: currency('PLN'),
      }),
      'id-4',
    );

    expect(result).not.toBeNull();
    expect(result?.type).toBe('buy');
    expect(result?.instrument).toBeNull();
    expect(result?.quantity.toString()).toBe('0');
    expect(result?.price).toBeNull();
    expect(result?.grossAmount?.toString()).toBe('100 PLN');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toMatch(/Could not parse the trade detail/);
    expect(result?.warnings[0]).toContain('coś nietypowego, nie pasuje do wzorca');
  });
});

describe('mapBosRow — dividend', () => {
  it('maps a dividend title with a trailing currency qualifier, stripping it from the ticker', () => {
    const result = mapBosRow(
      row({
        title: 'Wypłata dywidendy brutto VWRL EUR',
        amount: new Decimal(12.5),
        currency: currency('USD'),
      }),
      'id-5',
    );

    expect(result?.type).toBe('dividend');
    expect(result?.instrument).toEqual({ symbol: 'VWRL', exchange: null, name: null, isin: null });
    // The row's own currency (what actually arrived) is USD, not the qualifier (EUR).
    expect(result?.grossAmount?.toString()).toBe('12.5 USD');
    expect(result?.currency).toBe(currency('USD'));
  });

  it('maps a dividend title with no trailing currency qualifier', () => {
    const result = mapBosRow(
      row({
        title: 'Wypłata dywidendy brutto ETFSP500',
        amount: new Decimal(30),
        currency: currency('PLN'),
      }),
      'id-6',
    );

    expect(result?.type).toBe('dividend');
    expect(result?.instrument).toEqual({
      symbol: 'ETFSP500',
      exchange: null,
      name: null,
      isin: null,
    });
    expect(result?.grossAmount?.toString()).toBe('30 PLN');
  });
});

describe('mapBosRow — currency exchange', () => {
  it('maps the negative (paying-out) leg to transfer_out with no instrument', () => {
    const result = mapBosRow(
      row({
        title: 'Wymiana waluty PLN/EUR 4.3000',
        amount: new Decimal(-4300),
        currency: currency('PLN'),
      }),
      'id-7',
    );

    expect(result?.type).toBe('transfer_out');
    expect(result?.instrument).toBeNull();
    expect(result?.grossAmount?.toString()).toBe('4300 PLN');
  });

  it('maps the positive (received) leg to transfer_in with no instrument', () => {
    const result = mapBosRow(
      row({
        title: 'Wymiana waluty PLN/EUR 4.3000',
        amount: new Decimal(1000),
        currency: currency('EUR'),
      }),
      'id-8',
    );

    expect(result?.type).toBe('transfer_in');
    expect(result?.instrument).toBeNull();
    expect(result?.grossAmount?.toString()).toBe('1000 EUR');
  });
});

describe('mapBosRow — unrecognized title', () => {
  it('falls back to deposit for a positive amount, with a warning naming the raw title', () => {
    const result = mapBosRow(
      row({
        title: 'Odsetki od środków pieniężnych',
        amount: new Decimal(4.2),
        currency: currency('PLN'),
      }),
      'id-9',
    );

    expect(result?.type).toBe('deposit');
    expect(result?.instrument).toBeNull();
    expect(result?.grossAmount?.toString()).toBe('4.2 PLN');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toContain('Odsetki od środków pieniężnych');
    expect(result?.warnings[0]).toMatch(/no specific mapping/);
  });

  it('falls back to withdrawal for a negative amount', () => {
    const result = mapBosRow(
      row({
        title: 'Jakaś nieznana operacja',
        amount: new Decimal(-15),
        currency: currency('PLN'),
      }),
      'id-10',
    );

    expect(result?.type).toBe('withdrawal');
    expect(result?.grossAmount?.toString()).toBe('15 PLN');
    expect(result?.warnings[0]).toContain('Jakaś nieznana operacja');
  });
});

describe('mapBosRow — zero amount', () => {
  it('returns null for a zero-amount row regardless of title', () => {
    expect(mapBosRow(row({ amount: new Decimal(0) }), 'id-11')).toBeNull();
  });

  it('returns null for a zero-amount unrecognized row', () => {
    expect(
      mapBosRow(row({ title: 'Something else entirely', amount: new Decimal(0) }), 'id-12'),
    ).toBeNull();
  });
});
