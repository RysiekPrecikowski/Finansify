import {
  accountId as toAccountId,
  currency as toCurrency,
  instrumentId as toInstrumentId,
  Money,
  portfolioId as toPortfolioId,
  Temporal,
  transactionId as toTransactionId,
  type Account,
  type AccountInput,
  type ImportedTransactionOrigin,
  type Instrument,
  type InstrumentInput,
  type InstrumentRepository,
  type LedgerRepository,
  type Portfolio,
  type ScopedLedgerRepository,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  type UserId,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import { type Database } from './client';
import { accounts, type AccountRow } from './schema/accounts';
import { instruments, type InstrumentRow } from './schema/instruments';
import { portfolioAccounts, portfolios, type PortfolioRow } from './schema/portfolios';
import { transactions, type TransactionRow } from './schema/transactions';

/**
 * The persistence adapter for `core`'s ledger ports.
 *
 * Every query in this file filters on the `userId` captured by `forUser`
 * (rule 4). ADR 0009 declined row-level security on the strength of that
 * shape, which means **there is no database-level backstop**: a missing
 * `eq(table.userId, userId)` here is a cross-account data leak that nothing
 * below will catch.
 *
 * `numeric` columns arrive from Postgres as strings and are handed straight to
 * `Decimal`. No `Number()` or `parseFloat` appears anywhere in this file — the
 * precision guarantee of ADR 0005 either survives this boundary or it survives
 * nowhere.
 */

function toPlainDate(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}

function toAccount(row: AccountRow): Account {
  return {
    id: toAccountId(row.id),
    name: row.name,
    broker: row.broker,
    wrapper: row.wrapper,
    currency: toCurrency(row.currency),
    openedAt: toPlainDate(row.openedAt),
    closedAt: row.closedAt === null ? null : toPlainDate(row.closedAt),
  };
}

function toInstrument(row: InstrumentRow): Instrument {
  return {
    id: toInstrumentId(row.id),
    kind: row.kind,
    isin: row.isin,
    symbol: row.symbol,
    exchange: row.exchange,
    currency: toCurrency(row.currency),
    name: row.name,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  const currency = toCurrency(row.currency);
  const money = (value: string | null): Money | null =>
    value === null ? null : Money.of(value, currency);

  return {
    id: toTransactionId(row.id),
    accountId: toAccountId(row.accountId),
    instrumentId: row.instrumentId === null ? null : toInstrumentId(row.instrumentId),
    type: row.type,
    tradeDate: toPlainDate(row.tradeDate),
    settleDate: row.settleDate === null ? null : toPlainDate(row.settleDate),
    quantity: new Decimal(row.quantity),
    price: money(row.price),
    grossAmount: money(row.grossAmount),
    fee: Money.of(row.fee, currency),
    tax: Money.of(row.tax, currency),
    currency,
    fxRate: row.fxRate === null ? null : new Decimal(row.fxRate),
    fxRateSource: row.fxRateSource,
    source: row.source,
    externalId: row.externalId,
    importBatchId: row.importBatchId,
    editedAfterImport: row.editedAfterImport,
    deleted: row.deletedAt !== null,
    // jsonb carries a bare string[]; the brand only exists in `core`, so the
    // parse back has to happen here or the ids reach the domain unvalidated.
    matchedLotIds: row.matchedLotIds === null ? null : row.matchedLotIds.map(toTransactionId),
    note: row.note,
  };
}

function toPortfolio(row: PortfolioRow, memberships: readonly { accountId: string }[]): Portfolio {
  return {
    id: toPortfolioId(row.id),
    name: row.name,
    accountIds: memberships.map((membership) => toAccountId(membership.accountId)),
  };
}

/** The row shape a `TransactionInput` becomes. Strings in, strings out. */
function toRow(input: TransactionInput, userId: UserId) {
  return {
    userId,
    accountId: input.accountId,
    instrumentId: input.instrumentId,
    type: input.type,
    tradeDate: input.tradeDate,
    settleDate: input.settleDate,
    quantity: input.quantity,
    price: input.price,
    grossAmount: input.grossAmount,
    fee: input.fee,
    tax: input.tax,
    currency: toCurrency(input.currency),
    fxRate: input.fxRate,
    fxRateSource: input.fxRateSource,
    note: input.note,
  };
}

function scopedTo(db: Database, userId: UserId): ScopedLedgerRepository {
  // Captured once. Nothing below reads a user id from an argument, which is
  // what makes an unscoped query unexpressible rather than merely discouraged.
  const owned = {
    account: eq(accounts.userId, userId),
    portfolio: eq(portfolios.userId, userId),
    transaction: eq(transactions.userId, userId),
  };

  async function requireOwnTransaction(id: TransactionId): Promise<TransactionRow> {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(owned.transaction, eq(transactions.id, id), isNull(transactions.deletedAt)))
      .limit(1);

    // Deliberately the same failure whether the row belongs to someone else or
    // does not exist: telling them apart would confirm another user's ids.
    if (row === undefined) throw new Error(`No transaction ${id}`);
    return row;
  }

  return {
    async listAccounts() {
      const rows = await db
        .select()
        .from(accounts)
        .where(owned.account)
        .orderBy(asc(accounts.openedAt), asc(accounts.id));
      return rows.map(toAccount);
    },

    async createAccount(input: AccountInput) {
      const [row] = await db
        .insert(accounts)
        .values({
          userId,
          name: input.name,
          broker: input.broker,
          wrapper: input.wrapper,
          currency: input.currency,
          openedAt: input.openedAt.toString(),
        })
        .returning();
      return toAccount(row!);
    },

    async listPortfolios() {
      const rows = await db
        .select()
        .from(portfolios)
        .where(owned.portfolio)
        .orderBy(asc(portfolios.name));
      if (rows.length === 0) return [];

      const memberships = await db
        .select({
          portfolioId: portfolioAccounts.portfolioId,
          accountId: portfolioAccounts.accountId,
        })
        .from(portfolioAccounts)
        .where(
          inArray(
            portfolioAccounts.portfolioId,
            rows.map((row) => row.id),
          ),
        );

      return rows.map((row) =>
        toPortfolio(
          row,
          memberships.filter((membership) => membership.portfolioId === row.id),
        ),
      );
    },

    async ensureDefaultPortfolio(name: string) {
      const existing = await db
        .select()
        .from(portfolios)
        .where(and(owned.portfolio, eq(portfolios.name, name)))
        .limit(1);
      if (existing[0] !== undefined) return toPortfolio(existing[0], []);

      // Same shape as `findOrCreateUser`: insert, and if a concurrent first
      // request won the race, re-read rather than surfacing a constraint error.
      const [inserted] = await db
        .insert(portfolios)
        .values({ userId, name })
        .onConflictDoNothing({ target: [portfolios.userId, portfolios.name] })
        .returning();
      if (inserted !== undefined) return toPortfolio(inserted, []);

      const [afterConflict] = await db
        .select()
        .from(portfolios)
        .where(and(owned.portfolio, eq(portfolios.name, name)))
        .limit(1);
      if (afterConflict === undefined) {
        throw new Error('Default portfolio insert conflicted but no row was found afterward');
      }
      return toPortfolio(afterConflict, []);
    },

    async listTransactions() {
      const rows = await db
        .select()
        .from(transactions)
        .where(and(owned.transaction, isNull(transactions.deletedAt)))
        .orderBy(asc(transactions.tradeDate), asc(transactions.id));
      return rows.map(toTransaction);
    },

    async getTransaction(id: TransactionId) {
      const [row] = await db
        .select()
        .from(transactions)
        .where(and(owned.transaction, eq(transactions.id, id), isNull(transactions.deletedAt)))
        .limit(1);
      return row === undefined ? null : toTransaction(row);
    },

    async createTransaction(input: TransactionInput) {
      const [row] = await db.insert(transactions).values(toRow(input, userId)).returning();
      return toTransaction(row!);
    },

    async updateTransaction(id: TransactionId, input: TransactionInput) {
      const current = await requireOwnTransaction(id);

      const [row] = await db
        .update(transactions)
        .set({
          ...toRow(input, userId),
          updatedAt: new Date(),
          // A hand correction to an imported row must surface as a conflict on
          // the next import rather than being silently overwritten (ADR 0004).
          editedAfterImport: current.source === 'import' ? true : current.editedAfterImport,
        })
        .where(and(owned.transaction, eq(transactions.id, id)))
        .returning();
      return toTransaction(row!);
    },

    async softDeleteTransaction(id: TransactionId) {
      await requireOwnTransaction(id);
      await db
        .update(transactions)
        // Soft, not hard: a hard-deleted row has no `external_id` left to match
        // against, so the next import silently recreates it (ADR 0004).
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(owned.transaction, eq(transactions.id, id)));
    },

    async findByExternalId(accountId, externalId) {
      const [row] = await db
        .select()
        .from(transactions)
        .where(
          and(
            owned.transaction,
            eq(transactions.accountId, accountId),
            eq(transactions.externalId, externalId),
            // Deliberately unfiltered by `deleted_at`: the unique index on
            // (account_id, external_id) counts soft-deleted rows, so hiding
            // them here is what let `acceptImportRow` collide with one. The
            // caller decides what a deleted counterpart means.
          ),
        )
        .limit(1);
      return row === undefined ? null : toTransaction(row);
    },

    async createImportedTransaction(input: TransactionInput, origin: ImportedTransactionOrigin) {
      const [row] = await db
        .insert(transactions)
        .values({
          ...toRow(input, userId),
          source: 'import',
          externalId: origin.externalId,
          importBatchId: origin.importBatchId,
        })
        .returning();
      return toTransaction(row!);
    },

    async refreshImportedTransaction(id: TransactionId, input: TransactionInput) {
      await requireOwnTransaction(id);
      const [row] = await db
        .update(transactions)
        // Deliberately no `editedAfterImport` write — this is a re-import
        // refreshing a row nobody has touched, not a hand correction, and it
        // must stay `false` so the *next* re-import can still refresh it too.
        .set({ ...toRow(input, userId), updatedAt: new Date() })
        .where(and(owned.transaction, eq(transactions.id, id)))
        .returning();
      return toTransaction(row!);
    },
  };
}

export function ledgerRepository(db: Database): LedgerRepository {
  return { forUser: (userId: UserId) => scopedTo(db, userId) };
}

/**
 * Instruments are global (`docs/domain.md`), so this is deliberately outside
 * the user-scoped repository — there is nothing private here to leak, and
 * scoping it would give every user their own duplicate of the same security.
 */
export function instrumentRepository(db: Database): InstrumentRepository {
  return {
    async findOrCreate(input: InstrumentInput) {
      const exchange = input.exchange ?? null;
      const [existing] = await db
        .select()
        .from(instruments)
        .where(and(eq(instruments.symbol, input.symbol), eqOrNull(exchange)))
        .limit(1);
      if (existing !== undefined) return toInstrument(existing);

      const [inserted] = await db
        .insert(instruments)
        .values({
          symbol: input.symbol,
          name: input.name,
          kind: input.kind,
          currency: input.currency,
          isin: input.isin ?? null,
          exchange,
        })
        .onConflictDoNothing({ target: [instruments.symbol, instruments.exchange] })
        .returning();
      if (inserted !== undefined) return toInstrument(inserted);

      const [afterConflict] = await db
        .select()
        .from(instruments)
        .where(and(eq(instruments.symbol, input.symbol), eqOrNull(exchange)))
        .limit(1);
      if (afterConflict === undefined) {
        throw new Error(`Instrument ${input.symbol} conflicted but no row was found afterward`);
      }
      return toInstrument(afterConflict);
    },

    async listAll() {
      const rows = await db.select().from(instruments).orderBy(asc(instruments.symbol));
      return rows.map(toInstrument);
    },

    async findById(id) {
      const [row] = await db.select().from(instruments).where(eq(instruments.id, id)).limit(1);
      return row === undefined ? null : toInstrument(row);
    },

    async search(query) {
      const needle = `%${query}%`;
      const rows = await db
        .select()
        .from(instruments)
        .where(or(ilike(instruments.symbol, needle), ilike(instruments.name, needle)))
        .orderBy(asc(instruments.symbol))
        .limit(20);
      return rows.map(toInstrument);
    },
  };
}

/**
 * `exchange = NULL` never matches in SQL, and most instruments have no
 * exchange, so the lookup has to switch on it or the upsert re-inserts forever.
 */
function eqOrNull(exchange: string | null) {
  return exchange === null ? isNull(instruments.exchange) : eq(instruments.exchange, exchange);
}
