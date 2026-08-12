import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { Money, currency } from '../money';
import { userId, type UserId } from '../ports/session';
import { Temporal } from '../time';
import { type LedgerRepository, type ScopedLedgerRepository } from './ports';
import {
  accountId,
  portfolioId,
  transactionId,
  transactionInputSchema,
  type Account,
  type AccountInput,
  type Portfolio,
  type Transaction,
  type TransactionId,
  type TransactionInput,
} from './types';

const PLN = currency('PLN');

class TransactionNotFoundError extends Error {}

/**
 * One table, one scoping predicate — the same shape a SQL adapter has, minus
 * the SQL. ADR 0009 declined row-level security on the strength of
 * `forUser(userId)` being the only way to reach a row, so a fake that captures
 * the user once and filters every read on it is exactly the thing under test.
 */
class InMemoryLedger implements LedgerRepository {
  private readonly accountRows: { owner: UserId; account: Account }[] = [];
  private readonly portfolioRows: { owner: UserId; portfolio: Portfolio }[] = [];
  private readonly transactionRows: {
    owner: UserId;
    transaction: Transaction;
    deleted: boolean;
  }[] = [];
  private sequence = 0;

  private nextId(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
  }

  /** Rows visible to nobody but their owner, including soft-deleted ones. */
  rawRowCount(): number {
    return this.transactionRows.length;
  }

  isDeleted(id: TransactionId): boolean {
    return this.transactionRows.find((row) => row.transaction.id === id)?.deleted ?? false;
  }

  forUser(user: UserId): ScopedLedgerRepository {
    const visible = (id: TransactionId) =>
      this.transactionRows.find(
        (row) => row.owner === user && !row.deleted && row.transaction.id === id,
      );

    return {
      listAccounts: () =>
        Promise.resolve(
          this.accountRows.filter((row) => row.owner === user).map((row) => row.account),
        ),

      createAccount: (input: AccountInput) => {
        const account: Account = {
          id: accountId(this.nextId()),
          name: input.name,
          broker: input.broker,
          wrapper: input.wrapper,
          currency: input.currency,
          openedAt: input.openedAt,
          closedAt: null,
        };
        this.accountRows.push({ owner: user, account });
        return Promise.resolve(account);
      },

      listPortfolios: () =>
        Promise.resolve(
          this.portfolioRows.filter((row) => row.owner === user).map((row) => row.portfolio),
        ),

      ensureDefaultPortfolio: (name: string) => {
        const existing = this.portfolioRows.find((row) => row.owner === user);
        if (existing !== undefined) return Promise.resolve(existing.portfolio);

        const portfolio: Portfolio = { id: portfolioId(this.nextId()), name, accountIds: [] };
        this.portfolioRows.push({ owner: user, portfolio });
        return Promise.resolve(portfolio);
      },

      listTransactions: () =>
        Promise.resolve(
          this.transactionRows
            .filter((row) => row.owner === user && !row.deleted)
            .map((row) => row.transaction)
            .sort((left, right) => Temporal.PlainDate.compare(left.tradeDate, right.tradeDate)),
        ),

      getTransaction: (id: TransactionId) => Promise.resolve(visible(id)?.transaction ?? null),

      createTransaction: (input: TransactionInput) => {
        const transaction = materialise(transactionId(this.nextId()), input);
        this.transactionRows.push({ owner: user, transaction, deleted: false });
        return Promise.resolve(transaction);
      },

      updateTransaction: (id: TransactionId, input: TransactionInput) => {
        const row = visible(id);
        if (row === undefined) return Promise.reject(new TransactionNotFoundError(id));
        row.transaction = materialise(id, input);
        return Promise.resolve(row.transaction);
      },

      softDeleteTransaction: (id: TransactionId) => {
        const row = visible(id);
        if (row === undefined) return Promise.reject(new TransactionNotFoundError(id));
        row.deleted = true;
        return Promise.resolve();
      },
    };
  }
}

/** The strings a form submits become `Money` and `Decimal` here and nowhere else. */
function materialise(id: TransactionId, input: TransactionInput): Transaction {
  const txCurrency = currency(input.currency);

  return {
    id,
    accountId: input.accountId,
    instrumentId: input.instrumentId,
    type: input.type,
    tradeDate: Temporal.PlainDate.from(input.tradeDate),
    settleDate: input.settleDate === null ? null : Temporal.PlainDate.from(input.settleDate),
    quantity: new Decimal(input.quantity),
    price: input.price === null ? null : Money.of(input.price, txCurrency),
    grossAmount: input.grossAmount === null ? null : Money.of(input.grossAmount, txCurrency),
    fee: Money.of(input.fee, txCurrency),
    tax: Money.of(input.tax, txCurrency),
    currency: txCurrency,
    fxRate: input.fxRate === null ? null : new Decimal(input.fxRate),
    fxRateSource: input.fxRateSource,
    source: 'manual',
    externalId: null,
    importBatchId: null,
    editedAfterImport: false,
    matchedLotIds: null,
    note: input.note,
  };
}

const accountInput = (name: string): AccountInput => ({
  name,
  broker: 'XTB',
  wrapper: 'brokerage',
  currency: PLN,
  openedAt: Temporal.PlainDate.from('2024-01-01'),
});

const buyInput = (account: Account, tradeDate: string, quantity: string): TransactionInput =>
  transactionInputSchema.parse({
    accountId: account.id,
    type: 'buy',
    tradeDate,
    quantity,
    price: '100.00',
    currency: 'PLN',
  });

async function seed(ledger: InMemoryLedger, user: UserId, label: string) {
  const scoped = ledger.forUser(user);
  const account = await scoped.createAccount(accountInput(`${label} brokerage`));
  await scoped.ensureDefaultPortfolio(`${label} portfolio`);
  const first = await scoped.createTransaction(buyInput(account, '2024-02-01', '10'));
  const second = await scoped.createTransaction(buyInput(account, '2024-03-01', '20'));
  return { scoped, account, first, second };
}

describe('LedgerRepository scoping', () => {
  it('shows each user only their own accounts', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    expect((await a.scoped.listAccounts()).map((item) => item.id)).toEqual([a.account.id]);
    expect((await b.scoped.listAccounts()).map((item) => item.id)).toEqual([b.account.id]);
  });

  it('gives each user their own default portfolio rather than sharing one', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    const [portfolioA] = await a.scoped.listPortfolios();
    const [portfolioB] = await b.scoped.listPortfolios();

    expect(await a.scoped.listPortfolios()).toHaveLength(1);
    expect(await b.scoped.listPortfolios()).toHaveLength(1);
    expect(portfolioA!.id).not.toBe(portfolioB!.id);
    // Called twice, it must return the same one and not provision a second.
    expect((await a.scoped.ensureDefaultPortfolio('again')).id).toBe(portfolioA!.id);
    expect(await a.scoped.listPortfolios()).toHaveLength(1);
  });

  it('shows each user only their own transactions', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    expect((await a.scoped.listTransactions()).map((item) => item.id)).toEqual([
      a.first.id,
      a.second.id,
    ]);
    expect((await b.scoped.listTransactions()).map((item) => item.id)).toEqual([
      b.first.id,
      b.second.id,
    ]);
    expect(ledger.rawRowCount()).toBe(4);
  });

  it('refuses to fetch a transaction belonging to another user', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    // Knowing the id is not authorisation: there is no unscoped read path.
    expect(await a.scoped.getTransaction(b.first.id)).toBeNull();
    expect(await b.scoped.getTransaction(a.first.id)).toBeNull();
    expect(await a.scoped.getTransaction(a.first.id)).not.toBeNull();
  });

  it('refuses to update a transaction belonging to another user', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    await expect(
      a.scoped.updateTransaction(b.first.id, buyInput(a.account, '2024-02-01', '999')),
    ).rejects.toThrow(TransactionNotFoundError);

    const untouched = await b.scoped.getTransaction(b.first.id);
    expect(untouched!.quantity.equals(10)).toBe(true);
  });

  it('refuses to soft-delete a transaction belonging to another user', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    await expect(a.scoped.softDeleteTransaction(b.first.id)).rejects.toThrow(
      TransactionNotFoundError,
    );
    expect(ledger.isDeleted(b.first.id)).toBe(false);
    expect(await b.scoped.listTransactions()).toHaveLength(2);
  });

  it('hides a soft-deleted row from its owner and leaves the other user alone', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    await a.scoped.softDeleteTransaction(a.first.id);

    expect((await a.scoped.listTransactions()).map((item) => item.id)).toEqual([a.second.id]);
    expect(await a.scoped.getTransaction(a.first.id)).toBeNull();
    expect(await b.scoped.listTransactions()).toHaveLength(2);
    // Soft, not hard: import idempotency depends on the row surviving (ADR 0004).
    expect(ledger.rawRowCount()).toBe(4);
  });
});
