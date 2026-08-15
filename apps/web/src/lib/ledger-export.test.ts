import Decimal from 'decimal.js';
import {
  accountId,
  currency,
  instrumentId,
  Money,
  Temporal,
  transactionId,
  type Account,
  type Instrument,
  type LedgerExportRow,
} from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { toCsv, toExportRecord, toJson } from './ledger-export';

const ACCOUNT: Account = {
  id: accountId('11111111-1111-4111-8111-111111111111'),
  name: 'XTB brokerage',
  broker: 'XTB',
  wrapper: 'brokerage',
  currency: currency('PLN'),
  openedAt: Temporal.PlainDate.from('2020-01-01'),
  closedAt: null,
};

const INSTRUMENT: Instrument = {
  id: instrumentId('22222222-2222-4222-8222-222222222222'),
  kind: 'equity',
  isin: 'US0378331005',
  symbol: 'AAPL',
  exchange: 'NASDAQ',
  currency: currency('USD'),
  name: 'Apple Inc.',
};

/** A fully populated row — every optional and nullable field present. */
function fullRow(overrides: Partial<LedgerExportRow> = {}): LedgerExportRow {
  return {
    transactionId: transactionId('33333333-3333-4333-8333-333333333333'),
    account: ACCOUNT,
    instrument: INSTRUMENT,
    type: 'buy',
    tradeDate: Temporal.PlainDate.from('2024-03-10'),
    settleDate: Temporal.PlainDate.from('2024-03-12'),
    quantity: new Decimal('10'),
    price: Money.of('150.25', currency('USD')),
    grossAmount: Money.of('1502.50', currency('USD')),
    fee: Money.of('5', currency('USD')),
    tax: Money.of('0', currency('USD')),
    currency: currency('USD'),
    fxRate: new Decimal('4.05'),
    fxRateSource: 'broker',
    source: 'manual',
    externalId: 'ext-abc-123',
    matchedLotIds: [
      transactionId('44444444-4444-4444-8444-444444444444'),
      transactionId('55555555-5555-4555-8555-555555555555'),
    ],
    note: 'ordinary note',
    ...overrides,
  };
}

describe('toExportRecord', () => {
  it('maps every field of a full row, including a multi-id matchedLotIds join', () => {
    const record = toExportRecord(fullRow());

    expect(record).toEqual({
      transactionId: '33333333-3333-4333-8333-333333333333',
      accountId: '11111111-1111-4111-8111-111111111111',
      accountName: 'XTB brokerage',
      accountBroker: 'XTB',
      accountWrapper: 'brokerage',
      accountCurrency: 'PLN',
      instrumentId: '22222222-2222-4222-8222-222222222222',
      instrumentSymbol: 'AAPL',
      instrumentIsin: 'US0378331005',
      instrumentExchange: 'NASDAQ',
      instrumentName: 'Apple Inc.',
      instrumentKind: 'equity',
      type: 'buy',
      tradeDate: '2024-03-10',
      settleDate: '2024-03-12',
      quantity: '10',
      price: '150.25',
      grossAmount: '1502.5',
      fee: '5',
      tax: '0',
      currency: 'USD',
      fxRate: '4.05',
      fxRateSource: 'broker',
      source: 'manual',
      externalId: 'ext-abc-123',
      matchedLotIds: '44444444-4444-4444-8444-444444444444;55555555-5555-4555-8555-555555555555',
      note: 'ordinary note',
    });
  });

  it('maps every instrument* key to null for a cash movement with no instrument', () => {
    const record = toExportRecord(
      fullRow({
        instrument: null,
        type: 'deposit',
        price: null,
        grossAmount: Money.of('1000', currency('PLN')),
      }),
    );

    expect(record.instrumentId).toBeNull();
    expect(record.instrumentSymbol).toBeNull();
    expect(record.instrumentIsin).toBeNull();
    expect(record.instrumentExchange).toBeNull();
    expect(record.instrumentName).toBeNull();
    expect(record.instrumentKind).toBeNull();
  });

  it('maps the nullable transaction-level fields to null, not undefined or the string "null"', () => {
    const record = toExportRecord(
      fullRow({
        price: null,
        grossAmount: null,
        fxRate: null,
        fxRateSource: null,
        settleDate: null,
        note: null,
        externalId: null,
        matchedLotIds: null,
      }),
    );

    expect(record.price).toBeNull();
    expect(record.grossAmount).toBeNull();
    expect(record.fxRate).toBeNull();
    expect(record.fxRateSource).toBeNull();
    expect(record.settleDate).toBeNull();
    expect(record.note).toBeNull();
    expect(record.externalId).toBeNull();
    expect(record.matchedLotIds).toBeNull();

    for (const value of [
      record.price,
      record.grossAmount,
      record.fxRate,
      record.fxRateSource,
      record.settleDate,
      record.note,
      record.externalId,
      record.matchedLotIds,
    ]) {
      expect(value).not.toBe('null');
      expect(value).not.toBeUndefined();
    }
  });

  it('preserves decimal precision exactly, without rounding or locale grouping', () => {
    const record = toExportRecord(
      fullRow({
        quantity: new Decimal('1234567.123456789'),
        price: Money.of('0.30000000', currency('USD')),
        fxRate: new Decimal('4.0512345'),
      }),
    );

    expect(record.quantity).toBe('1234567.123456789');
    expect(record.price).toBe('0.3'); // Decimal#toString() normalizes trailing zeros, not a locale reformat.
    expect(record.fxRate).toBe('4.0512345');
  });
});

describe('toJson', () => {
  it('is valid JSON that round-trips to an array of the records toExportRecord produces', () => {
    const rows = [fullRow(), fullRow({ instrument: null, note: null })];

    const parsed = JSON.parse(toJson(rows)) as unknown[];

    expect(parsed).toEqual(rows.map(toExportRecord));
  });

  it('keeps null as null through the round trip rather than dropping the key or turning it into undefined', () => {
    const row = fullRow({ note: null, externalId: null, matchedLotIds: null });

    const parsed = JSON.parse(toJson([row])) as Record<string, unknown>[];

    expect(parsed).toHaveLength(1);
    expect(Object.hasOwn(parsed[0]!, 'note')).toBe(true);
    expect(parsed[0]!.note).toBeNull();
    expect(Object.hasOwn(parsed[0]!, 'externalId')).toBe(true);
    expect(parsed[0]!.externalId).toBeNull();
    expect(Object.hasOwn(parsed[0]!, 'matchedLotIds')).toBe(true);
    expect(parsed[0]!.matchedLotIds).toBeNull();
  });

  it('serializes an empty array of rows as "[]"', () => {
    expect(JSON.parse(toJson([]))).toEqual([]);
  });
});

describe('toCsv', () => {
  it('joins the header and one row with \\r\\n, comma-separating fields', () => {
    const row = fullRow({
      instrument: null,
      type: 'deposit',
      price: null,
      fxRate: null,
      fxRateSource: null,
      settleDate: null,
      externalId: null,
      matchedLotIds: null,
      note: 'plain note',
      grossAmount: Money.of('1000', currency('PLN')),
      currency: currency('PLN'),
    });

    expect(toCsv([row])).toBe(
      [
        'transactionId,accountId,accountName,accountBroker,accountWrapper,accountCurrency,instrumentId,instrumentSymbol,instrumentIsin,instrumentExchange,instrumentName,instrumentKind,type,tradeDate,settleDate,quantity,price,grossAmount,fee,tax,currency,fxRate,fxRateSource,source,externalId,matchedLotIds,note',
        '33333333-3333-4333-8333-333333333333,11111111-1111-4111-8111-111111111111,XTB brokerage,XTB,brokerage,PLN,,,,,,,deposit,2024-03-10,,10,,1000,5,0,PLN,,,manual,,,plain note',
      ].join('\r\n'),
    );
  });

  it('emits only the header line for an empty array of rows', () => {
    expect(toCsv([])).toBe(
      'transactionId,accountId,accountName,accountBroker,accountWrapper,accountCurrency,instrumentId,instrumentSymbol,instrumentIsin,instrumentExchange,instrumentName,instrumentKind,type,tradeDate,settleDate,quantity,price,grossAmount,fee,tax,currency,fxRate,fxRateSource,source,externalId,matchedLotIds,note',
    );
  });

  it('wraps a field containing a comma in quotes', () => {
    const csv = toCsv([fullRow({ note: 'Sold, then rebought' })]);
    const [, dataLine] = csv.split('\r\n');

    expect(dataLine).toContain('"Sold, then rebought"');
  });

  it('doubles an embedded double quote and wraps the field in quotes', () => {
    const csv = toCsv([fullRow({ note: 'Broker called it "final" settlement' })]);
    const [, dataLine] = csv.split('\r\n');

    expect(dataLine).toContain('"Broker called it ""final"" settlement"');
  });

  it('wraps a field containing an embedded newline in quotes', () => {
    const csv = toCsv([fullRow({ note: 'line one\nline two' })]);

    expect(csv).toContain('"line one\nline two"');
  });

  it('does not quote an ordinary field with no comma, quote, or newline', () => {
    const csv = toCsv([fullRow({ note: 'ordinary note' })]);
    const [, dataLine] = csv.split('\r\n');

    expect(dataLine).toContain(',ordinary note');
    expect(dataLine).not.toContain('"ordinary note"');
  });
});
