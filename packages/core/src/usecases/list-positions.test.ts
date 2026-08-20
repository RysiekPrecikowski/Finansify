import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { type Account, type Instrument, type TransactionInput } from '../ledger';
import { InMemoryInstruments, InMemoryLedger } from '../ledger/in-memory-ledger';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { MixedCurrencyPositionError } from '../positions';
import { Temporal } from '../time';
import { makeListPositions } from './list-positions';

const USER = userId('11111111-1111-4111-8111-111111111111');

/**
 * Untyped-at-the-edge in production, but this suite bypasses `recordTransaction`
 * and writes straight through the port, so the shape here is `TransactionInput`
 * itself rather than the loose `unknown` a form would submit.
 *
 * `instrumentId` has no default: `InMemoryInstruments.findOrCreate` assigns ids
 * itself, so every caller passes the id `setupInstrument` actually returned
 * rather than a value that only coincidentally matches.
 */
function buy(
  overrides: Partial<TransactionInput> & {
    accountId: Account['id'];
    instrumentId: Instrument['id'];
  },
): TransactionInput {
  return {
    type: 'buy',
    tradeDate: '2024-01-10',
    settleDate: null,
    quantity: '10',
    price: '100',
    grossAmount: null,
    fee: '0',
    tax: '0',
    currency: 'PLN',
    fxRate: null,
    fxRateSource: null,
    note: null,
    ...overrides,
  };
}

function sell(
  overrides: Partial<TransactionInput> & {
    accountId: Account['id'];
    instrumentId: Instrument['id'];
  },
): TransactionInput {
  return { ...buy(overrides), type: 'sell' };
}

async function setupInstrument(instruments: InMemoryInstruments): Promise<Instrument> {
  return instruments.findOrCreate({
    symbol: 'AAPL',
    name: 'Apple Inc.',
    kind: 'equity',
    currency: currency('USD'),
  });
}

async function plnAccount(ledger: InMemoryLedger, name = 'PLN brokerage'): Promise<Account> {
  return ledger.forUser(USER).createAccount({
    name,
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: currency('PLN'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });
}

async function usdAccount(ledger: InMemoryLedger, name = 'USD brokerage'): Promise<Account> {
  return ledger.forUser(USER).createAccount({
    name,
    broker: 'IBKR',
    wrapper: 'brokerage',
    currency: currency('USD'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });
}

describe('makeListPositions', () => {
  it('aggregates two buys in one account into one open position', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '100',
        tradeDate: '2024-01-10',
      }),
    );
    await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '5',
        price: '120',
        tradeDate: '2024-02-10',
      }),
    );

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(1);
    const position = view.open[0]!;
    expect(position.instrument.symbol).toBe('AAPL');
    expect(position.quantity.equals(new Decimal('15'))).toBe(true);
    // 10 * 100 + 5 * 120 = 1600
    expect(position.costBasisByCurrency).toHaveLength(1);
    expect(position.costBasisByCurrency[0]!.equals(Money.of('1600', currency('PLN')))).toBe(true);
    expect(position.averageCost?.toFixed()).toBe(new Decimal('1600').dividedBy('15').toFixed());
    expect(position.lines).toHaveLength(1);
    expect(position.lines[0]!.lots).toHaveLength(2);
  });

  it('sums quantity and cost basis across two accounts sharing a currency', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const accountA = await plnAccount(ledger, 'PLN A');
    const accountB = await plnAccount(ledger, 'PLN B');
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({ accountId: accountA.id, instrumentId: instrument.id, quantity: '10', price: '100' }),
    );
    await scoped.createTransaction(
      buy({ accountId: accountB.id, instrumentId: instrument.id, quantity: '4', price: '90' }),
    );

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(1);
    const position = view.open[0]!;
    expect(position.quantity.equals(new Decimal('14'))).toBe(true);
    expect(position.costBasisByCurrency).toHaveLength(1);
    // 10*100 + 4*90 = 1360
    expect(position.costBasisByCurrency[0]!.equals(Money.of('1360', currency('PLN')))).toBe(true);
    expect(position.lines).toHaveLength(2);
  });

  it('keeps cost basis per currency and leaves averageCost null across a currency split', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const pln = await plnAccount(ledger);
    const usd = await usdAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({
        accountId: pln.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '100',
        currency: 'PLN',
      }),
    );
    await scoped.createTransaction(
      buy({
        accountId: usd.id,
        instrumentId: instrument.id,
        quantity: '5',
        price: '150',
        currency: 'USD',
      }),
    );

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(1);
    const position = view.open[0]!;
    expect(position.quantity.equals(new Decimal('15'))).toBe(true);
    expect(position.costBasisByCurrency).toHaveLength(2);
    expect(position.averageCost).toBeNull();
  });

  it('moves a fully sold position to closed with the exact realized amount, and out of open', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '100',
        tradeDate: '2024-01-10',
      }),
    );
    await scoped.createTransaction(
      sell({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '130',
        tradeDate: '2024-03-10',
      }),
    );

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(0);
    expect(view.closed).toHaveLength(1);
    const closed = view.closed[0]!;
    expect(closed.quantity.equals(new Decimal('0'))).toBe(true);
    // proceeds 1300 - cost 1000 = 300
    expect(closed.realizedByCurrency).toHaveLength(1);
    expect(closed.realizedByCurrency[0]!.equals(Money.of('300', currency('PLN')))).toBe(true);
  });

  it('keeps a foreign-currency buy in its own settlement currency, never the account currency', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '100',
        currency: 'USD',
        fxRate: null,
        fxRateSource: null,
      }),
    );

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(1);
    const position = view.open[0]!;
    // 10 * 100 USD = 1000 USD, the transaction's own currency — no rate needed.
    expect(position.costBasisByCurrency).toHaveLength(1);
    expect(position.costBasisByCurrency[0]!.equals(Money.of('1000', currency('USD')))).toBe(true);
  });

  it('rejects a single account whose lots for one instrument mix currencies (ADR 0021)', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '100',
        currency: 'USD',
      }),
    );
    await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '5',
        price: '150',
        currency: 'PLN',
        tradeDate: '2024-02-10',
      }),
    );

    const listPositions = makeListPositions({ ledger: scoped, instruments });

    await expect(listPositions()).rejects.toThrow(MixedCurrencyPositionError);
  });

  it('moves cash for deposits and dividends without creating a position', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction({
      accountId: account.id,
      instrumentId: null,
      type: 'deposit',
      tradeDate: '2024-01-01',
      settleDate: null,
      quantity: '0',
      price: null,
      grossAmount: '1000',
      fee: '0',
      tax: '0',
      currency: 'PLN',
      fxRate: null,
      fxRateSource: null,
      note: null,
    });

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(0);
    expect(view.closed).toHaveLength(0);
    expect(view.cash).toHaveLength(1);
    expect(view.cash[0]!.account.id).toBe(account.id);
    expect(view.cash[0]!.amount.equals(Money.of('1000', currency('PLN')))).toBe(true);
  });

  it('excludes a soft-deleted transaction from both positions and cash', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    const created = await scoped.createTransaction(
      buy({ accountId: account.id, instrumentId: instrument.id, quantity: '10', price: '100' }),
    );
    await scoped.softDeleteTransaction(created.id);

    const listPositions = makeListPositions({ ledger: scoped, instruments });
    const view = await listPositions();

    expect(view.open).toHaveLength(0);
    expect(view.closed).toHaveLength(0);
    expect(view.cash).toHaveLength(0);
  });
});
