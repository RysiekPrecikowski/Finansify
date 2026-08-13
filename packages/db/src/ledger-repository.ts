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
  type Currency,
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
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { type Database } from './client';
import { rowCipherFor, type RowCipher } from './crypto';
import { ensureDataKey } from './users';
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
 * Amounts never reach a column of their own: they are sealed into one encrypted
 * payload per row (ADR 0013), so this file is also where the guarantee a
 * `numeric` column used to give is reconstructed — every amount goes in and
 * comes out through `canonical`, and nothing else can write one.
 *
 * No `Number()` or `parseFloat` appears anywhere here. The precision guarantee
 * of ADR 0005 either survives this boundary or it survives nowhere.
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

/**
 * The encrypted half of a transaction row (ADR 0013). Every numeric field is a
 * **canonical `Decimal` string** — see `canonical`.
 */
export interface TransactionPayload {
  readonly quantity: string;
  readonly price: string | null;
  readonly grossAmount: string | null;
  readonly fee: string;
  readonly tax: string;
  readonly fxRate: string | null;
  readonly note: string | null;
}

/**
 * The single gate every amount passes through on its way into the database.
 *
 * A `numeric(28, 10)` column used to refuse a value that was not a number; a
 * ciphertext column cannot, so that guarantee has to be reconstructed here. It
 * comes out stronger than the column's was: `Decimal` rejects anything
 * unparseable, and re-serializing its output means the payload can only ever
 * contain a string `Decimal` itself produced. The column would have accepted
 * `1e5` and quietly stored `100000`; this stores exactly one agreed form.
 */
export function canonical(value: string): string {
  return new Decimal(value).toFixed();
}

export function canonicalOrNull(value: string | null): string | null {
  return value === null ? null : canonical(value);
}

/**
 * Parses a decrypted payload rather than asserting its shape. A corrupted or
 * truncated payload has to fail here, loudly and with the row id attached —
 * casting it would only defer the failure to some later `Decimal` call with no
 * idea which row it came from.
 */
export function decodePayload(value: unknown, rowId: string): TransactionPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Transaction ${rowId} decrypted to ${typeof value}, expected an object`);
  }
  const raw = value as Record<string, unknown>;

  // Wraps `canonical`'s own error rather than letting it propagate bare: a raw
  // `DecimalError` says which value was bad but not which row it came from,
  // and the row id is the one thing a caller actually needs to act on this.
  const decimal = (field: keyof TransactionPayload, candidate: string): string => {
    try {
      return canonical(candidate);
    } catch (cause) {
      throw new Error(`Transaction ${rowId} payload has an unparseable "${field}"`, { cause });
    }
  };

  const required = (field: keyof TransactionPayload): string => {
    const candidate = raw[field];
    if (typeof candidate !== 'string') {
      throw new Error(`Transaction ${rowId} payload is missing "${field}"`);
    }
    return decimal(field, candidate);
  };

  const optional = (field: keyof TransactionPayload): string | null => {
    const candidate = raw[field];
    if (candidate === null || candidate === undefined) return null;
    if (typeof candidate !== 'string') {
      throw new Error(`Transaction ${rowId} payload has a non-string "${field}"`);
    }
    return decimal(field, candidate);
  };

  return {
    quantity: required('quantity'),
    price: optional('price'),
    grossAmount: optional('grossAmount'),
    fee: required('fee'),
    tax: required('tax'),
    fxRate: optional('fxRate'),
    note: typeof raw.note === 'string' ? raw.note : null,
  };
}

function toTransaction(row: TransactionRow, cipher: RowCipher): Transaction {
  const currency = toCurrency(row.currency);
  const payload = decodePayload(cipher.decrypt(row.encrypted, 'transactions', row.id), row.id);
  const money = (value: string | null): Money | null =>
    value === null ? null : Money.of(value, currency);

  return {
    id: toTransactionId(row.id),
    accountId: toAccountId(row.accountId),
    instrumentId: row.instrumentId === null ? null : toInstrumentId(row.instrumentId),
    type: row.type,
    tradeDate: toPlainDate(row.tradeDate),
    settleDate: row.settleDate === null ? null : toPlainDate(row.settleDate),
    quantity: new Decimal(payload.quantity),
    price: money(payload.price),
    grossAmount: money(payload.grossAmount),
    fee: Money.of(payload.fee, currency),
    tax: Money.of(payload.tax, currency),
    currency,
    fxRate: payload.fxRate === null ? null : new Decimal(payload.fxRate),
    fxRateSource: row.fxRateSource,
    source: row.source,
    externalId: row.externalId,
    importBatchId: row.importBatchId,
    editedAfterImport: row.editedAfterImport,
    // jsonb carries a bare string[]; the brand only exists in `core`, so the
    // parse back has to happen here or the ids reach the domain unvalidated.
    matchedLotIds: row.matchedLotIds === null ? null : row.matchedLotIds.map(toTransactionId),
    note: payload.note,
  };
}

function toPortfolio(row: PortfolioRow, memberships: readonly { accountId: string }[]): Portfolio {
  return {
    id: toPortfolioId(row.id),
    name: row.name,
    accountIds: memberships.map((membership) => toAccountId(membership.accountId)),
  };
}

/**
 * Splits an input into the columns the database has to act on and the payload
 * it must never see. The row id is generated here rather than defaulted by
 * Postgres, because the AAD binds the payload to it and it therefore has to
 * exist before the encryption happens.
 */
function toRow(input: TransactionInput, userId: UserId, cipher: RowCipher, id: string) {
  const payload: TransactionPayload = {
    quantity: canonical(input.quantity),
    price: canonicalOrNull(input.price),
    grossAmount: canonicalOrNull(input.grossAmount),
    fee: canonical(input.fee),
    tax: canonical(input.tax),
    fxRate: canonicalOrNull(input.fxRate),
    note: input.note,
  };

  return {
    id,
    userId,
    accountId: input.accountId,
    instrumentId: input.instrumentId,
    type: input.type,
    tradeDate: input.tradeDate,
    settleDate: input.settleDate,
    currency: toCurrency(input.currency),
    fxRateSource: input.fxRateSource,
    encrypted: cipher.encrypt(payload, 'transactions', id),
  };
}

function scopedTo(db: Database, userId: UserId, masterKey: Buffer): ScopedLedgerRepository {
  // Captured once. Nothing below reads a user id from an argument, which is
  // what makes an unscoped query unexpressible rather than merely discouraged.
  const owned = {
    account: eq(accounts.userId, userId),
    portfolio: eq(portfolios.userId, userId),
    transaction: eq(transactions.userId, userId),
  };

  // Resolved once per repository and reused: unwrapping is cheap, but a fresh
  // round trip to `users` on every row would not be.
  let pending: Promise<RowCipher> | undefined;
  function cipher(): Promise<RowCipher> {
    pending ??= ensureDataKey(db, userId, masterKey).then((dataKey) =>
      rowCipherFor(dataKey, userId),
    );
    return pending;
  }

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
      const [rows, rowCipher] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(and(owned.transaction, isNull(transactions.deletedAt)))
          .orderBy(asc(transactions.tradeDate), asc(transactions.id)),
        cipher(),
      ]);
      return rows.map((row) => toTransaction(row, rowCipher));
    },

    async getTransaction(id: TransactionId) {
      const [row] = await db
        .select()
        .from(transactions)
        .where(and(owned.transaction, eq(transactions.id, id), isNull(transactions.deletedAt)))
        .limit(1);
      return row === undefined ? null : toTransaction(row, await cipher());
    },

    async createTransaction(input: TransactionInput) {
      const rowCipher = await cipher();
      const [row] = await db
        .insert(transactions)
        .values(toRow(input, userId, rowCipher, randomUUID()))
        .returning();
      return toTransaction(row!, rowCipher);
    },

    async updateTransaction(id: TransactionId, input: TransactionInput) {
      const [current, rowCipher] = await Promise.all([requireOwnTransaction(id), cipher()]);

      const [row] = await db
        .update(transactions)
        .set({
          ...toRow(input, userId, rowCipher, id),
          updatedAt: new Date(),
          // A hand correction to an imported row must surface as a conflict on
          // the next import rather than being silently overwritten (ADR 0004).
          editedAfterImport: current.source === 'import' ? true : current.editedAfterImport,
        })
        .where(and(owned.transaction, eq(transactions.id, id)))
        .returning();
      return toTransaction(row!, rowCipher);
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
  };
}

export function ledgerRepository(db: Database, masterKey: Buffer): LedgerRepository {
  return { forUser: (userId: UserId) => scopedTo(db, userId, masterKey) };
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
  };
}

/**
 * `exchange = NULL` never matches in SQL, and most instruments have no
 * exchange, so the lookup has to switch on it or the upsert re-inserts forever.
 */
function eqOrNull(exchange: string | null) {
  return exchange === null ? isNull(instruments.exchange) : eq(instruments.exchange, exchange);
}

export type { Currency };
