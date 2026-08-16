import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  type AccountId,
  type InstrumentId,
  type Transaction,
  type TransactionId,
  type TransactionType,
} from '../ledger';
import { Money, currency, type Currency } from '../money';
import { Temporal } from '../time';
import { buildCashBalances, type CashBalance } from './build-cash-balances';

const PLN = currency('PLN');
const USD = currency('USD');

interface TransactionFields {
  id: string;
  accountId: string;
  type: TransactionType;
  instrumentId?: string | null;
  grossAmount?: string;
  fee?: string;
  tax?: string;
  currency?: Currency;
  fxRate?: string | null;
}

function transaction(fields: TransactionFields): Transaction {
  const txCurrency = fields.currency ?? PLN;
  const fxRate = fields.fxRate ?? null;

  return {
    id: fields.id as TransactionId,
    accountId: fields.accountId as AccountId,
    instrumentId: (fields.instrumentId ?? null) as InstrumentId | null,
    type: fields.type,
    tradeDate: Temporal.PlainDate.from('2024-01-01'),
    settleDate: null,
    quantity: new Decimal('0'),
    price: null,
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
    matchedLotIds: null,
    note: null,
  };
}

const balanceOf = (
  balances: readonly CashBalance[],
  accountId: string,
  balanceCurrency: Currency,
): CashBalance =>
  balances.find((item) => item.accountId === accountId && item.currency === balanceCurrency)!;

describe('buildCashBalances', () => {
  it('charges a buy gross + fee + tax and credits a sell gross - fee - tax', () => {
    // -1020.00 for the buy, +492.00 for the sell.
    const balances = buildCashBalances([
      transaction({
        id: 'buy-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        grossAmount: '1000.00',
        fee: '19.00',
        tax: '1.00',
      }),
      transaction({
        id: 'sell-1',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'sell',
        grossAmount: '500.00',
        fee: '5.00',
        tax: '3.00',
      }),
    ]);

    expect(balances).toHaveLength(1);
    expect(balanceOf(balances, 'acc', PLN).amount.equals(Money.of('-528.00', PLN))).toBe(true);
  });

  it('moves cash the right way for every non-trade row', () => {
    // A standalone fee or tax row carries its amount as gross, not in the
    // per-trade `fee`/`tax` columns, or it would be counted twice.
    //   +10000.00 deposit  -2000.00 withdrawal  +121.50 dividend net of tax
    //   +12.34 interest  -9.99 fee  -100.00 tax  =  8023.85
    const balances = buildCashBalances([
      transaction({ id: 'dep', accountId: 'acc', type: 'deposit', grossAmount: '10000.00' }),
      transaction({ id: 'wd', accountId: 'acc', type: 'withdrawal', grossAmount: '2000.00' }),
      transaction({
        id: 'div',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'dividend',
        grossAmount: '150.00',
        tax: '28.50',
      }),
      transaction({ id: 'int', accountId: 'acc', type: 'interest', grossAmount: '12.34' }),
      transaction({ id: 'fee', accountId: 'acc', type: 'fee', grossAmount: '9.99' }),
      transaction({ id: 'tax', accountId: 'acc', type: 'tax', grossAmount: '100.00' }),
    ]);

    expect(balances).toHaveLength(1);
    expect(balanceOf(balances, 'acc', PLN).amount.equals(Money.of('8023.85', PLN))).toBe(true);
  });

  it('keeps one balance per currency and converts nothing', () => {
    // The cash leg settles in the transaction currency, so a USD trade on a PLN
    // account genuinely creates a USD sub-balance. Collapsing the two needs a
    // valuation-date rate nobody has here, and the transaction's own executed
    // rate is not one (rule 6).
    const balances = buildCashBalances([
      transaction({ id: 'dep', accountId: 'acc', type: 'deposit', grossAmount: '5000.00' }),
      transaction({
        id: 'buy-usd',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'buy',
        grossAmount: '800.00',
        fee: '2.00',
        currency: USD,
        fxRate: '4.0000',
      }),
    ]);

    expect(balances).toHaveLength(2);
    expect(balanceOf(balances, 'acc', PLN).amount.equals(Money.of('5000.00', PLN))).toBe(true);
    expect(balanceOf(balances, 'acc', USD).amount.equals(Money.of('-802.00', USD))).toBe(true);
    // Nothing was netted at 4.0000: the PLN side is untouched by the USD trade.
    expect(balances.every((item) => item.amount.currency === item.currency)).toBe(true);
  });

  it('moves cash for a cash transfer and not for a securities transfer', () => {
    const securitiesOnly = buildCashBalances([
      transaction({
        id: 'sec-in',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'transfer_in',
        grossAmount: '1000.00',
      }),
      transaction({
        id: 'sec-out',
        accountId: 'acc',
        instrumentId: 'inst',
        type: 'transfer_out',
        grossAmount: '400.00',
      }),
    ]);

    expect(securitiesOnly).toEqual([]);

    const cashOnly = buildCashBalances([
      transaction({ id: 'cash-in', accountId: 'acc', type: 'transfer_in', grossAmount: '1000.00' }),
      transaction({
        id: 'cash-out',
        accountId: 'acc',
        type: 'transfer_out',
        grossAmount: '300.00',
      }),
    ]);

    expect(cashOnly).toHaveLength(1);
    expect(balanceOf(cashOnly, 'acc', PLN).amount.equals(Money.of('700.00', PLN))).toBe(true);
  });

  it('keeps accounts apart', () => {
    const balances = buildCashBalances([
      transaction({ id: 'a', accountId: 'acc-1', type: 'deposit', grossAmount: '100.00' }),
      transaction({ id: 'b', accountId: 'acc-2', type: 'deposit', grossAmount: '250.00' }),
    ]);

    expect(balances).toHaveLength(2);
    expect(balanceOf(balances, 'acc-1', PLN).amount.equals(Money.of('100.00', PLN))).toBe(true);
    expect(balanceOf(balances, 'acc-2', PLN).amount.equals(Money.of('250.00', PLN))).toBe(true);
  });
});
