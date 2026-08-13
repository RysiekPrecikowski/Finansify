import Decimal from 'decimal.js';

import { Money, currency } from '../money';
import { type UserId } from '../ports/session';
import { Temporal } from '../time';
import { type LedgerRepository, type ScopedLedgerRepository } from './ports';
import {
  accountId,
  portfolioId,
  transactionId,
  type Account,
  type AccountInput,
  type Portfolio,
  type Transaction,
  type TransactionId,
  type TransactionInput,
} from './types';

export class TransactionNotFoundError extends Error {}

/**
 * One table, one scoping predicate — the same shape a SQL adapter has, minus
 * the SQL. ADR 0009 declined row-level security on the strength of
 * `forUser(userId)` being the only way to reach a row, so a fake that captures
 * the user once and filters every read on it is exactly the thing under test.
 *
 * A test double, not production code — `./index` and the package root never
 * re-export it. It lives here (rather than inline in a single test file) so
 * both `ledger-repository.test.ts` and the `usecases` test suite can share one
 * fake instead of two drifting copies.
 */
export class InMemoryLedger implements LedgerRepository {
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
