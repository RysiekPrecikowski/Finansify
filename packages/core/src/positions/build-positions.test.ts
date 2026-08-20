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
  MixedCurrencyPositionError,
  UnknownAccountError,
  UnsupportedTransactionTypeError,
  averageCostOf,
  buildPositions,
  type Position,
} from './build-positions';

const PLN = currency('PLN');
const EUR = currency('EUR');

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

  // ADR 0021: cost basis lives in the currency the position was actually
  // settled in, never converted to the account's currency.

  it('holds cost basis in the transaction currency, not the account currency, with no rate needed', () => {
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
        currency: EUR,
      }),
      transaction({
        id: 'buy-2',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-02-01',
        quantity: '5',
        price: '12.00',
        fee: '1.00',
        currency: EUR,
      }),
      transaction({
        id: 'buy-3',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-03-01',
        quantity: '5',
        price: '11.00',
        currency: EUR,
      }),
    ];

    const position = only(buildPositions(transactions, [account('acc', PLN)]));

    expect(position.currency).toBe(EUR);
    expect(position.quantity.equals(20)).toBe(true);
    // Plain EUR sums: 100.00 + (60.00 + 1.00) + 55.00 — no rate applied anywhere.
    expect(position.costBasis.equals(Money.of('216.00', EUR))).toBe(true);
  });

  it('fixes the queue currency from the first chronological transaction, not the first array element', () => {
    const transactions = [
      // Later-dated PLN buy appears first in the array...
      transaction({
        id: 'buy-pln',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-06-01',
        quantity: '10',
        price: '10.00',
        currency: PLN,
      }),
      // ...but this EUR buy is chronologically first.
      transaction({
        id: 'buy-eur',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
        currency: EUR,
      }),
    ];

    expect(() => buildPositions(transactions, [account('acc', PLN)])).toThrow(
      MixedCurrencyPositionError,
    );

    // Confirm the direction: the EUR-only prefix alone builds a EUR position.
    const eurOnly = only(buildPositions([transactions[1]!], [account('acc', PLN)]));
    expect(eurOnly.currency).toBe(EUR);
  });

  it('produces no position for dividends, interest or deposits in a foreign currency', () => {
    const transactions = [
      transaction({
        id: 'div-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'dividend',
        tradeDate: '2024-01-01',
        grossAmount: '50.00',
        currency: EUR,
      }),
      transaction({
        id: 'int-1',
        accountId: 'acc',
        type: 'interest',
        tradeDate: '2024-01-02',
        grossAmount: '5.00',
        currency: EUR,
      }),
      transaction({
        id: 'dep-1',
        accountId: 'acc',
        type: 'deposit',
        tradeDate: '2024-01-03',
        grossAmount: '1000.00',
        currency: EUR,
      }),
    ];

    expect(buildPositions(transactions, [account('acc', PLN)])).toHaveLength(0);
  });

  it('produces no position for cash-only transfers with no instrument', () => {
    const transactions = [
      transaction({
        id: 'xfer-in',
        accountId: 'acc',
        instrumentId: null,
        type: 'transfer_in',
        tradeDate: '2024-01-01',
        grossAmount: '500.00',
        currency: EUR,
      }),
      transaction({
        id: 'xfer-out',
        accountId: 'acc',
        instrumentId: null,
        type: 'transfer_out',
        tradeDate: '2024-01-02',
        grossAmount: '500.00',
        currency: EUR,
      }),
    ];

    expect(buildPositions(transactions, [account('acc', PLN)])).toHaveLength(0);
  });

  it('refuses a currency-mixed lot queue, naming both currencies, whether or not a rate is set', () => {
    const withoutRate = [
      transaction({
        id: 'buy-eur',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
        currency: EUR,
      }),
      transaction({
        id: 'buy-pln',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-02-01',
        quantity: '10',
        price: '10.00',
        currency: PLN,
      }),
    ];

    expect(() => buildPositions(withoutRate, [account('acc', PLN)])).toThrow(
      MixedCurrencyPositionError,
    );
    expect(() => buildPositions(withoutRate, [account('acc', PLN)])).toThrow(/PLN/);
    expect(() => buildPositions(withoutRate, [account('acc', PLN)])).toThrow(/EUR/);

    // A rate does not make the case supported: still refused with the rate present.
    const withRate = [
      withoutRate[0]!,
      transaction({
        id: 'buy-pln-rated',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-02-01',
        quantity: '10',
        price: '10.00',
        currency: PLN,
        fxRate: '4.3000',
      }),
    ];

    expect(() => buildPositions(withRate, [account('acc', PLN)])).toThrow(
      MixedCurrencyPositionError,
    );
  });

  it('denominates realized P&L in the queue currency', () => {
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
        currency: EUR,
      }),
      transaction({
        id: 'sell-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'sell',
        tradeDate: '2024-02-01',
        quantity: '10',
        price: '12.00',
        currency: EUR,
      }),
    ];

    const position = only(buildPositions(transactions, [account('acc', PLN)]));

    expect(position.realized.currency).toBe(EUR);
    expect(position.realized.equals(Money.of('20.00', EUR))).toBe(true);
  });

  it('throws UnknownAccountError for a transaction naming an account not supplied', () => {
    const transactions = [
      transaction({
        id: 'buy-1',
        accountId: 'ghost-acc',
        instrumentId: 'inst',
        type: 'buy',
        tradeDate: '2024-01-01',
        quantity: '10',
        price: '10.00',
      }),
    ];

    expect(() => buildPositions(transactions, [account('acc')])).toThrow(UnknownAccountError);
  });
});
