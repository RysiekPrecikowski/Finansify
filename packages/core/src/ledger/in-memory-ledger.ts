import Decimal from 'decimal.js';

import { Money, currency } from '../money';
import { type UserId } from '../ports/session';
import { Temporal } from '../time';
import {
  type ImportedTransactionOrigin,
  type InstrumentInput,
  type InstrumentRepository,
  type LedgerRepository,
  type ScopedLedgerRepository,
} from './ports';
import {
  accountId,
  instrumentId,
  portfolioId,
  transactionId,
  type Account,
  type AccountId,
  type AccountInput,
  type Instrument,
  type InstrumentId,
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
    return (
      this.transactionRows.find((row) => row.transaction.id === id)?.transaction.deleted ?? false
    );
  }

  forUser(user: UserId): ScopedLedgerRepository {
    const visible = (id: TransactionId) =>
      this.transactionRows.find(
        (row) => row.owner === user && !row.transaction.deleted && row.transaction.id === id,
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
            .filter((row) => row.owner === user && !row.transaction.deleted)
            .map((row) => row.transaction)
            .sort((left, right) => Temporal.PlainDate.compare(left.tradeDate, right.tradeDate)),
        ),

      getTransaction: (id: TransactionId) => Promise.resolve(visible(id)?.transaction ?? null),

      createTransaction: (input: TransactionInput) => {
        const transaction = materialise(transactionId(this.nextId()), input);
        this.transactionRows.push({ owner: user, transaction });
        return Promise.resolve(transaction);
      },

      updateTransaction: (id: TransactionId, input: TransactionInput) => {
        const row = visible(id);
        if (row === undefined) return Promise.reject(new TransactionNotFoundError(id));
        const current = row.transaction;
        const refreshed = materialise(id, input);
        row.transaction = {
          ...refreshed,
          // `TransactionInput` carries none of these — an update must not
          // silently strip a row's import provenance, so they survive from
          // whatever the row already had, exactly as the real adapter's
          // `.set()` never touching these columns leaves them in place.
          source: current.source,
          externalId: current.externalId,
          importBatchId: current.importBatchId,
          // Mirrors `packages/db/src/ledger-repository.ts`: any update to a
          // row that originated as an import is treated as the hand
          // correction `editedAfterImport` exists to flag (ADR 0004).
          editedAfterImport: current.source === 'import' ? true : current.editedAfterImport,
        };
        return Promise.resolve(row.transaction);
      },

      softDeleteTransaction: (id: TransactionId) => {
        const row = visible(id);
        if (row === undefined) return Promise.reject(new TransactionNotFoundError(id));
        row.transaction = { ...row.transaction, deleted: true };
        return Promise.resolve();
      },

      // Deliberately unfiltered by `deleted`, mirroring the real adapter's
      // `findByExternalId` — a soft-deleted transaction still occupies
      // `(account_id, external_id)`, so dedup has to see it.
      findByExternalId: (accountId: AccountId, externalId: string) =>
        Promise.resolve(
          this.transactionRows.find(
            (row) =>
              row.owner === user &&
              row.transaction.accountId === accountId &&
              row.transaction.externalId === externalId,
          )?.transaction ?? null,
        ),

      findByExternalIds: (accountId: AccountId, externalIds: readonly string[]) => {
        const ids = new Set(externalIds);
        const found = new Map<string, Transaction>();
        for (const row of this.transactionRows) {
          if (row.owner !== user) continue;
          if (row.transaction.accountId !== accountId) continue;
          if (row.transaction.externalId === null) continue;
          if (!ids.has(row.transaction.externalId)) continue;
          found.set(row.transaction.externalId, row.transaction);
        }
        return Promise.resolve(found);
      },

      createImportedTransaction: (input: TransactionInput, origin: ImportedTransactionOrigin) => {
        if (hasExternalIdCollision(this.transactionRows, input.accountId, origin.externalId)) {
          return Promise.reject(externalIdCollisionError());
        }

        const base = materialise(transactionId(this.nextId()), input);
        const transaction: Transaction = {
          ...base,
          source: 'import',
          externalId: origin.externalId,
          importBatchId: origin.importBatchId,
        };
        this.transactionRows.push({ owner: user, transaction });
        return Promise.resolve(transaction);
      },

      createImportedTransactions: (
        items: readonly { input: TransactionInput; origin: ImportedTransactionOrigin }[],
      ) => {
        for (const { input, origin } of items) {
          if (hasExternalIdCollision(this.transactionRows, input.accountId, origin.externalId)) {
            return Promise.reject(externalIdCollisionError());
          }
        }

        const created = items.map(({ input, origin }) => {
          const base = materialise(transactionId(this.nextId()), input);
          const transaction: Transaction = {
            ...base,
            source: 'import',
            externalId: origin.externalId,
            importBatchId: origin.importBatchId,
          };
          this.transactionRows.push({ owner: user, transaction });
          return transaction;
        });
        return Promise.resolve(created);
      },

      refreshImportedTransaction: (id: TransactionId, input: TransactionInput) => {
        const row = visible(id);
        if (row === undefined) return Promise.reject(new TransactionNotFoundError(id));
        const current = row.transaction;
        const refreshed = materialise(id, input);
        row.transaction = {
          ...refreshed,
          source: current.source,
          externalId: current.externalId,
          importBatchId: current.importBatchId,
          // The whole point of this method versus `updateTransaction`: a
          // re-import refresh must leave this exactly as it was, never
          // recompute it — mirrors the real adapter never writing the column.
          editedAfterImport: current.editedAfterImport,
        };
        return Promise.resolve(row.transaction);
      },
    };
  }
}

/**
 * Minimal fake of the real `packages/db` adapter's dedup rule: one row per
 * `(symbol, exchange)`, where a `null` exchange is its own bucket rather than
 * a wildcard — mirrors `eqOrNull` in `packages/db/src/ledger-repository.ts`.
 *
 * A test double, not production code — same rationale as `InMemoryLedger`
 * above. Shared by every `usecases` test that needs instruments rather than
 * copied into each one (rule 13).
 */
export class InMemoryInstruments implements InstrumentRepository {
  private readonly rows: Instrument[] = [];
  private sequence = 0;

  private nextId(): InstrumentId {
    this.sequence += 1;
    return instrumentId(`00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`);
  }

  findOrCreate(input: InstrumentInput): Promise<Instrument> {
    const exchange = input.exchange ?? null;
    const existing = this.rows.find(
      (row) => row.symbol === input.symbol && row.exchange === exchange,
    );
    if (existing !== undefined) return Promise.resolve(existing);

    const instrument: Instrument = {
      id: this.nextId(),
      kind: input.kind,
      isin: input.isin ?? null,
      symbol: input.symbol,
      exchange,
      currency: input.currency,
      name: input.name,
    };
    this.rows.push(instrument);
    return Promise.resolve(instrument);
  }

  findById(id: InstrumentId): Promise<Instrument | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  listAll(): Promise<readonly Instrument[]> {
    return Promise.resolve([...this.rows]);
  }

  search(query: string): Promise<readonly Instrument[]> {
    const needle = query.toLowerCase();
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.symbol.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
      ),
    );
  }
}

/**
 * Mirrors the partial unique index on (account_id, external_id) in
 * `packages/db` — soft-deleted rows count. Without this the fake is more
 * permissive than Postgres and hides real dedup bugs. Not scoped by `owner`,
 * same as the real index: an account belongs to exactly one user, so this can
 * never collide across users anyway.
 */
function hasExternalIdCollision(
  rows: readonly { transaction: Transaction }[],
  accountId: AccountId,
  externalId: string,
): boolean {
  return rows.some(
    (row) => row.transaction.accountId === accountId && row.transaction.externalId === externalId,
  );
}

function externalIdCollisionError(): Error {
  return new Error(
    'duplicate key value violates unique constraint "transactions_account_external_id_idx"',
  );
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
    deleted: false,
    matchedLotIds: null,
    note: input.note,
  };
}
