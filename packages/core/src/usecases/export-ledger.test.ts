import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  accountId,
  instrumentId,
  type Account,
  type Instrument,
  type TransactionInput,
} from '../ledger';
import { InMemoryInstruments, InMemoryLedger } from '../ledger/in-memory-ledger';
import { currency, Money } from '../money';
import { UnknownAccountError } from '../positions';
import { userId } from '../ports';
import { Temporal } from '../time';
import { makeExportLedger } from './export-ledger';
import { UnknownInstrumentError } from './list-positions';

const USER = userId('11111111-1111-4111-8111-111111111111');

/**
 * Same shape as `list-positions.test.ts`'s own `buy` helper: this suite writes
 * straight through `ScopedLedgerRepository`, bypassing whatever a form would
 * validate, so the input is `TransactionInput` itself.
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
    fee: '1',
    tax: '0',
    currency: 'PLN',
    fxRate: null,
    fxRateSource: null,
    note: null,
    ...overrides,
  };
}

function deposit(
  overrides: Partial<TransactionInput> & { accountId: Account['id'] },
): TransactionInput {
  return {
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
    ...overrides,
  };
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

describe('makeExportLedger', () => {
  it('resolves to an empty array for a ledger with no transactions', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const scoped = ledger.forUser(USER);

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });
    const rows = await exportLedger();

    expect(rows).toEqual([]);
  });

  it('joins a buy transaction to its full account and instrument, copying every scalar field', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    const created = await scoped.createTransaction(
      buy({
        accountId: account.id,
        instrumentId: instrument.id,
        quantity: '10',
        price: '100',
        fee: '5',
        tax: '2',
        tradeDate: '2024-01-10',
        settleDate: '2024-01-12',
        currency: 'USD',
        fxRate: '4',
        fxRateSource: 'broker',
        note: 'opening buy',
      }),
    );

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });
    const rows = await exportLedger();

    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.transactionId).toBe(created.id);
    expect(row.account).toEqual(account);
    expect(row.instrument).toEqual(instrument);
    expect(row.type).toBe('buy');
    expect(row.tradeDate.toString()).toBe('2024-01-10');
    expect(row.settleDate?.toString()).toBe('2024-01-12');
    expect(row.quantity.equals(new Decimal('10'))).toBe(true);
    expect(row.price?.equals(Money.of('100', currency('USD')))).toBe(true);
    expect(row.grossAmount).toBeNull();
    expect(row.fee.equals(Money.of('5', currency('USD')))).toBe(true);
    expect(row.tax.equals(Money.of('2', currency('USD')))).toBe(true);
    expect(row.currency).toBe(currency('USD'));
    expect(row.fxRate?.equals(new Decimal('4'))).toBe(true);
    expect(row.fxRateSource).toBe('broker');
    expect(row.source).toBe('manual');
    expect(row.externalId).toBeNull();
    expect(row.matchedLotIds).toBeNull();
    expect(row.note).toBe('opening buy');
  });

  it('leaves instrument null for a cash-only transaction such as a deposit', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(deposit({ accountId: account.id }));

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });
    const rows = await exportLedger();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.instrument).toBeNull();
    expect(rows[0]!.type).toBe('deposit');
  });

  it('joins each row to its own transaction account, not the other account in the ledger', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const accountA = await plnAccount(ledger, 'PLN A');
    const accountB = await plnAccount(ledger, 'PLN B');
    const scoped = ledger.forUser(USER);

    await scoped.createTransaction(
      buy({
        accountId: accountA.id,
        instrumentId: instrument.id,
        tradeDate: '2024-01-05',
      }),
    );
    await scoped.createTransaction(
      buy({
        accountId: accountB.id,
        instrumentId: instrument.id,
        tradeDate: '2024-02-05',
      }),
    );

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });
    const rows = await exportLedger();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.account).toEqual(accountA);
    expect(rows[1]!.account).toEqual(accountB);
  });

  it('returns rows in the exact order listTransactions() produced, without reordering', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);

    // Created out of chronological order — the in-memory fake's
    // `listTransactions()` sorts by trade date ascending regardless of
    // insertion order, so the earliest trade date must come out first.
    const march = await scoped.createTransaction(
      buy({ accountId: account.id, instrumentId: instrument.id, tradeDate: '2024-03-01' }),
    );
    const january = await scoped.createTransaction(
      buy({ accountId: account.id, instrumentId: instrument.id, tradeDate: '2024-01-01' }),
    );
    const february = await scoped.createTransaction(
      buy({ accountId: account.id, instrumentId: instrument.id, tradeDate: '2024-02-01' }),
    );

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });
    const rows = await exportLedger();

    expect(rows.map((row) => row.transactionId)).toEqual([january.id, february.id, march.id]);
  });

  it('rejects with UnknownAccountError when a transaction references an account listAccounts() never returned', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const instrument = await setupInstrument(instruments);
    // A real account so the account list isn't empty, and a second,
    // never-created id planted straight onto a transaction — the in-memory
    // fake's `createTransaction` does not validate `accountId` against
    // `listAccounts()`, so this is reachable without hacking the fake.
    const realAccount = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);
    const ghostAccountId = accountId('00000000-0000-4000-8000-999999999999');

    await scoped.createTransaction(buy({ accountId: realAccount.id, instrumentId: instrument.id }));
    await scoped.createTransaction(buy({ accountId: ghostAccountId, instrumentId: instrument.id }));

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });

    await expect(exportLedger()).rejects.toThrow(UnknownAccountError);
  });

  it('rejects with UnknownInstrumentError when a transaction references an instrument listAll() never returned', async () => {
    const ledger = new InMemoryLedger();
    const instruments = new InMemoryInstruments();
    const account = await plnAccount(ledger);
    const scoped = ledger.forUser(USER);
    // Never registered through `instruments.findOrCreate` — the in-memory
    // fake's `createTransaction` does not validate `instrumentId` against
    // `instruments.listAll()` either, so this is likewise reachable directly.
    const ghostInstrumentId = instrumentId('00000000-0000-4000-9000-999999999999');

    await scoped.createTransaction(buy({ accountId: account.id, instrumentId: ghostInstrumentId }));

    const exportLedger = makeExportLedger({ ledger: scoped, instruments });

    await expect(exportLedger()).rejects.toThrow(UnknownInstrumentError);
  });
});
