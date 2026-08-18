import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  type Account,
  type AccountId,
  type InstrumentId,
  type Transaction,
  type TransactionId,
  type TransactionType,
} from '../ledger';
import { Money, currency, type Currency } from '../money';
import { Temporal } from '../time';
import {
  MissingExecutedRateError,
  UnsupportedTransactionTypeError,
  averageCostOf,
  buildPositions,
  type Position,
} from './build-positions';

const PLN = currency('PLN');
const USD = currency('USD');

// Ids are UUIDs in production; short labels keep the fixtures readable and the
// same-day tiebreak is a plain string compare either way.
function account(id: string, accountCurrency: Currency = PLN): Account {
  return {
    id: id as AccountId,
    name: `Account ${id}`,
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: accountCurrency,
    openedAt: Temporal.PlainDate.from('2023-01-01'),
    closedAt: null,
  };
}

interface TransactionFields {
  id: string;
  accountId: string;
  type: TransactionType;
  tradeDate: string;
  instrumentId?: string | null;
  quantity?: string;
  price?: string;
  grossAmount?: string;
  fee?: string;
  tax?: string;
  currency?: Currency;
  fxRate?: string | null;
  matchedLotIds?: readonly string[];
}

function transaction(fields: TransactionFields): Transaction {
  const txCurrency = fields.currency ?? PLN;
  const fxRate = fields.fxRate ?? null;

  return {
    id: fields.id as TransactionId,
    accountId: fields.accountId as AccountId,
    instrumentId: (fields.instrumentId ?? null) as InstrumentId | null,
    type: fields.type,
    tradeDate: Temporal.PlainDate.from(fields.tradeDate),
    settleDate: null,
    quantity: new Decimal(fields.quantity ?? '0'),
    price: fields.price === undefined ? null : Money.of(fields.price, txCurrency),
    grossAmount: fields.grossAmount === undefined ? null : Money.of(fields.grossAmount, txCurrency),
    fee: Money.of(fields.fee ?? '0', txCurrency),
    tax: Money.of(fields.tax ?? '0', txCurrency),
    currency: txCurrency,
    fxRate: fxRate === null ? null : new Decimal(fxRate),
    fxRateSource: fxRate === null ? null : 'broker',
    source: 'manual',
    externalId: null,
    importBatchId: null,
    editedAfterImport: false,
    deleted: false,
    matchedLotIds: (fields.matchedLotIds ?? null) as readonly TransactionId[] | null,
    note: null,
  };
}

const only = (positions: readonly Position[]): Position => {
  expect(positions).toHaveLength(1);
  return positions[0]!;
};

describe('buildPositions', () => {
  it('carries remaining quantity, basis and realized P&L through a partial sell', () => {
    // Hand-computed, deliberately not re-derived from the engine:
    //   buy 1   100 × 25.00 + 19.00 fee = 2519.00 basis
    //   buy 2    50 × 30.00 + 10.00 fee = 1510.00 basis
    //   sell    120 × 40.00 - 15.00 fee = 4785.00 net proceeds
    //   fifo consumes buy 1 whole (2519.00) then 20/50 of buy 2 (604.00)
    //   realized  = 4785.00 - 3123.00 = 1662.00
    //   remaining = 30 units carrying 1510.00 - 604.00 = 906.00
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-10',
        quantity: '100',
        price: '25.00',
        fee: '19.00',
      }),
      transaction({
        id: 'buy-2',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-02-10',
        quantity: '50',
        price: '30.00',
        fee: '10.00',
      }),
      transaction({
        id: 'sell-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'sell',
        tradeDate: '2024-03-10',
        quantity: '120',
        price: '40.00',
        fee: '15.00',
      }),
    ];

    const position = only(buildPositions(transactions, [account('acc')]));

    expect(position.quantity.equals(30)).toBe(true);
    expect(position.costBasis.equals(Money.of('906.00', PLN))).toBe(true);
    expect(position.realized.equals(Money.of('1662.00', PLN))).toBe(true);
    expect(position.lots).toHaveLength(1);
    expect(averageCostOf(position)!.equals('30.20')).toBe(true);
  });

  it('keeps accounts and instruments from bleeding into one another', () => {
    const accounts = [account('acc-1'), account('acc-2')];
    const transactions = [
      transaction({
        id: 'tx-1',
        accountId: 'acc-1',
        instrumentId: 'inst-a',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '100.00',
      }),
      transaction({
        id: 'tx-2',
        accountId: 'acc-1',
        instrumentId: 'inst-b',
        type: 'buy',
        tradeDate: '2024-01-02',
        quantity: '20',
        price: '200.00',
      }),
      transaction({
        id: 'tx-3',
        accountId: 'acc-2',
        instrumentId: 'inst-a',
        type: 'buy',
        tradeDate: '2024-01-03',
        quantity: '30',
        price: '300.00',
      }),
      transaction({
        id: 'tx-4',
        accountId: 'acc-2',
        instrumentId: 'inst-b',
        type: 'buy',
        tradeDate: '2024-01-04',
        quantity: '40',
        price: '400.00',
      }),
    ];

    const positions = buildPositions(transactions, accounts);
    const find = (accountId: string, instrumentId: string) =>
      positions.find((item) => item.accountId === accountId && item.instrumentId === instrumentId)!;

    expect(positions).toHaveLength(4);
    expect(find('acc-1', 'inst-a').costBasis.equals(Money.of('1000.00', PLN))).toBe(true);
    expect(find('acc-1', 'inst-b').costBasis.equals(Money.of('4000.00', PLN))).toBe(true);
    expect(find('acc-2', 'inst-a').costBasis.equals(Money.of('9000.00', PLN))).toBe(true);
    expect(find('acc-2', 'inst-b').costBasis.equals(Money.of('16000.00', PLN))).toBe(true);
    // The same instrument in two accounts stays two positions: lots belong to
    // the account that holds them, not to the instrument.
    expect(find('acc-1', 'inst-a').lots.map((lot) => lot.id)).toEqual(['tx-1']);
    expect(find('acc-2', 'inst-a').lots.map((lot) => lot.id)).toEqual(['tx-3']);
  });

  it('refuses a split rather than computing a basis it cannot compute', () => {
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '100.00',
      }),
      transaction({
        id: 'split-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'split',
        tradeDate: '2024-02-01',
        quantity: '2',
      }),
    ];

    expect(() => buildPositions(transactions, [account('acc')])).toThrow(
      UnsupportedTransactionTypeError,
    );
  });

  it('converts each leg at the rate stored on that transaction, not one shared rate', () => {
    // Rule 6 / ADR 0006: brokers convert at their own spread, so two USD buys
    // on the same PLN account land at two different rates and the basis has to
    // reflect both.
    //   buy A  10 × 20.00 USD + 1.00 fee = 201.00 USD × 4.0000 =  804.00 PLN
    //   buy B  10 × 25.00 USD + 2.00 fee = 252.00 USD × 4.5000 = 1134.00 PLN
    const transactions = [
      transaction({
        id: 'buy-a',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-05',
        quantity: '10',
        price: '20.00',
        fee: '1.00',
        currency: USD,
        fxRate: '4.0000',
      }),
      transaction({
        id: 'buy-b',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-06-05',
        quantity: '10',
        price: '25.00',
        fee: '2.00',
        currency: USD,
        fxRate: '4.5000',
      }),
    ];

    const position = only(buildPositions(transactions, [account('acc', PLN)]));

    expect(position.currency).toBe(PLN);
    expect(position.quantity.equals(20)).toBe(true);
    expect(position.costBasis.equals(Money.of('1938.00', PLN))).toBe(true);
    expect(position.lots[0]!.originalCost.equals(Money.of('804.00', PLN))).toBe(true);
    expect(position.lots[1]!.originalCost.equals(Money.of('1134.00', PLN))).toBe(true);
  });

  it('refuses a cross-currency leg with no executed rate rather than inventing one', () => {
    const transactions = [
      transaction({
        id: 'buy-a',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-05',
        quantity: '10',
        price: '20.00',
        currency: USD,
        fxRate: null,
      }),
    ];

    expect(() => buildPositions(transactions, [account('acc', PLN)])).toThrow(
      MissingExecutedRateError,
    );
  });

  it('leaves lots untouched for dividends, fees and deposits', () => {
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
      }),
      // A dividend carries an instrument but no units, so it must not open a lot.
      transaction({
        id: 'div-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'dividend',
        tradeDate: '2024-02-01',
        grossAmount: '50.00',
        tax: '9.50',
      }),
      transaction({
        id: 'fee-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'fee',
        tradeDate: '2024-03-01',
        grossAmount: '12.00',
      }),
      transaction({
        id: 'dep-1',
        accountId: 'acc',
        type: 'deposit',
        tradeDate: '2024-04-01',
        grossAmount: '1000.00',
      }),
    ];

    const position = only(buildPositions(transactions, [account('acc')]));

    expect(position.lots).toHaveLength(1);
    expect(position.quantity.equals(10)).toBe(true);
    expect(position.costBasis.equals(Money.of('100.00', PLN))).toBe(true);
    expect(position.realized.isZero()).toBe(true);
  });

  it('reports no average cost for a fully closed position instead of dividing by zero', () => {
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
      }),
      transaction({
        id: 'sell-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'sell',
        tradeDate: '2024-02-01',
        quantity: '10',
        price: '12.00',
      }),
    ];

    const position = only(buildPositions(transactions, [account('acc')]));

    expect(position.quantity.isZero()).toBe(true);
    expect(position.costBasis.isZero()).toBe(true);
    expect(position.realized.equals(Money.of('20.00', PLN))).toBe(true);
    expect(averageCostOf(position)).toBeNull();
  });
});
