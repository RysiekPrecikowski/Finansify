import {
  accountId,
  currency,
  Money,
  transactionId,
  userId,
  type AccountId,
  type TransactionInput,
  type UserId,
} from '@finansify/core';
import { and, eq, ilike, inArray, or } from 'drizzle-orm';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { type Database } from './client';
import { instrumentRepository, ledgerRepository } from './ledger-repository';
import { instruments } from './schema/instruments';
import { transactions, type TransactionRow } from './schema/transactions';

const USER_ID = userId('11111111-1111-4111-8111-111111111111');
const ACCOUNT_ID = accountId('22222222-2222-4222-8222-222222222222');
const TRANSACTION_ID = transactionId('33333333-3333-4333-8333-333333333333');

function transactionRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: TRANSACTION_ID,
    userId: USER_ID,
    accountId: ACCOUNT_ID,
    instrumentId: null,
    type: 'deposit',
    tradeDate: '2024-01-10',
    settleDate: null,
    quantity: '0',
    price: null,
    grossAmount: '1000',
    fee: '0',
    tax: '0',
    currency: 'PLN',
    fxRate: null,
    fxRateSource: null,
    source: 'manual',
    externalId: null,
    importBatchId: null,
    editedAfterImport: false,
    matchedLotIds: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    note: null,
    ...overrides,
  };
}

/**
 * Mocks only the `select().from().where().limit()`,
 * `insert(table).values(...).returning()`, and `update(table).set(...).where(...).returning()`
 * chain shapes this file's methods actually call — same rationale as
 * `import-repository.test.ts`'s `makeDb()`, scoped to what this file needs.
 * `updateResults` also backs `refreshImportedTransaction`'s own
 * `requireOwnTransaction` select via `selectResults` before its update.
 */
function makeDb(config: {
  selectResults?: TransactionRow[][];
  insertResults?: TransactionRow[][];
  updateResults?: TransactionRow[][];
}): {
  db: Database;
  select: Mock;
  from: Mock;
  where: Mock;
  limit: Mock;
  insert: Mock;
  insertValues: Mock;
  insertReturning: Mock;
  update: Mock;
  updateSet: Mock;
  updateWhere: Mock;
  updateReturning: Mock;
} {
  const limit = vi.fn();
  for (const rows of config.selectResults ?? []) limit.mockResolvedValueOnce(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const insertReturning = vi.fn();
  for (const rows of config.insertResults ?? []) insertReturning.mockResolvedValueOnce(rows);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn();
  for (const rows of config.updateResults ?? []) updateReturning.mockResolvedValueOnce(rows);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    db: { select, insert, update } as unknown as Database,
    select,
    from,
    where,
    limit,
    insert,
    insertValues,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    updateReturning,
  };
}

/** The exact predicate `findByExternalId` builds — reconstructed so a test can assert the adapter scoped the right clause without re-deriving drizzle's `SQL` internals by hand. */
function expectedFindByExternalIdWhere(user: UserId, account: AccountId, externalId: string) {
  return and(
    eq(transactions.userId, user),
    eq(transactions.accountId, account),
    eq(transactions.externalId, externalId),
  );
}

const IMPORTED_INPUT: TransactionInput = {
  accountId: ACCOUNT_ID,
  instrumentId: null,
  type: 'deposit',
  tradeDate: '2024-01-10',
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
};

describe('ledgerRepository — findByExternalId', () => {
  it('returns the transaction mapped from the row when one matches this account and externalId', async () => {
    const row = transactionRow({ externalId: 'row-1' });
    const { db } = makeDb({ selectResults: [[row]] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const found = await repo.findByExternalId(ACCOUNT_ID, 'row-1');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(TRANSACTION_ID);
    expect(found!.externalId).toBe('row-1');
    expect(found!.accountId).toBe(ACCOUNT_ID);
  });

  it('scopes the query to this user, the given account and externalId, and includes soft-deleted rows', async () => {
    const row = transactionRow({ externalId: 'row-1' });
    const { db, where } = makeDb({ selectResults: [[row]] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    await repo.findByExternalId(ACCOUNT_ID, 'row-1');

    expect(where).toHaveBeenCalledWith(expectedFindByExternalIdWhere(USER_ID, ACCOUNT_ID, 'row-1'));
  });

  // The mock cannot itself apply a WHERE clause, so a transaction belonging
  // to another user and one on a different account both look identical here:
  // an empty result set. The clause-shape test above is what actually proves
  // each of those is excluded by the query this builds — this test only
  // proves the empty-result path resolves null rather than throwing or
  // returning undefined. A soft-deleted row is no longer one of the reasons
  // the result would be empty — the query includes those now.
  it("resolves null, without throwing, when nothing matches — covers another user's transaction and a different account sharing the same externalId", async () => {
    const { db } = makeDb({ selectResults: [[]] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    await expect(repo.findByExternalId(ACCOUNT_ID, 'row-1')).resolves.toBeNull();
  });
});

/**
 * `findByExternalIds` calls `db.select().from().where()` directly — no
 * `.limit()` in the chain, unlike `findByExternalId` — so it needs its own
 * mock shape rather than `makeDb`'s.
 */
function makeFindByExternalIdsDb(config: { rows: TransactionRow[] }): {
  db: Database;
  select: Mock;
  from: Mock;
  where: Mock;
} {
  const where = vi.fn().mockResolvedValueOnce(config.rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as Database, select, from, where };
}

describe('ledgerRepository — findByExternalIds', () => {
  it('returns an empty map without querying when externalIds is empty', async () => {
    const { db, select } = makeFindByExternalIdsDb({ rows: [] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const found = await repo.findByExternalIds(ACCOUNT_ID, []);

    expect(found.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it('keys the result by externalId, one entry per matching row', async () => {
    const rowA = transactionRow({ externalId: 'row-1' });
    const rowB = transactionRow({
      id: '44444444-4444-4444-8444-444444444444',
      externalId: 'row-2',
    });
    const { db } = makeFindByExternalIdsDb({ rows: [rowA, rowB] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const found = await repo.findByExternalIds(ACCOUNT_ID, ['row-1', 'row-2', 'row-3']);

    expect(found.size).toBe(2);
    expect(found.get('row-1')?.id).toBe(TRANSACTION_ID);
    expect(found.get('row-2')?.id).toBe(transactionId('44444444-4444-4444-8444-444444444444'));
    expect(found.get('row-3')).toBeUndefined();
  });

  it('scopes the query to this user and account, unfiltered by deleted_at, same as findByExternalId', async () => {
    const { db, where } = makeFindByExternalIdsDb({ rows: [] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    await repo.findByExternalIds(ACCOUNT_ID, ['row-1']);

    expect(where).toHaveBeenCalledWith(
      and(
        eq(transactions.userId, USER_ID),
        eq(transactions.accountId, ACCOUNT_ID),
        inArray(transactions.externalId, ['row-1']),
      ),
    );
  });
});

describe('ledgerRepository — createImportedTransaction', () => {
  it('inserts with source import and the given externalId/importBatchId, and maps the returned row', async () => {
    const insertedRow = transactionRow({
      source: 'import',
      externalId: 'row-1',
      importBatchId: '55555555-5555-4555-8555-555555555555',
    });
    const { db, insert, insertValues } = makeDb({ insertResults: [[insertedRow]] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const transaction = await repo.createImportedTransaction(IMPORTED_INPUT, {
      externalId: 'row-1',
      importBatchId: '55555555-5555-4555-8555-555555555555',
    });

    expect(insert).toHaveBeenCalledWith(transactions);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        accountId: ACCOUNT_ID,
        source: 'import',
        externalId: 'row-1',
        importBatchId: '55555555-5555-4555-8555-555555555555',
      }),
    );
    expect(transaction.source).toBe('import');
    expect(transaction.externalId).toBe('row-1');
    expect(transaction.importBatchId).toBe('55555555-5555-4555-8555-555555555555');
    expect(transaction.id).toBe(TRANSACTION_ID);
  });
});

describe('ledgerRepository — createImportedTransactions', () => {
  it('returns an empty array without inserting when items is empty', async () => {
    const { db, insert } = makeDb({});
    const repo = ledgerRepository(db).forUser(USER_ID);

    const created = await repo.createImportedTransactions([]);

    expect(created).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts every item in one multi-row insert, each with source import and its own externalId', async () => {
    const rowA = transactionRow({ source: 'import', externalId: 'row-1' });
    const rowB = transactionRow({
      id: '44444444-4444-4444-8444-444444444444',
      source: 'import',
      externalId: 'row-2',
    });
    const { db, insert, insertValues } = makeDb({ insertResults: [[rowA, rowB]] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const created = await repo.createImportedTransactions([
      { input: IMPORTED_INPUT, origin: { externalId: 'row-1', importBatchId: '5555' } },
      {
        input: { ...IMPORTED_INPUT, grossAmount: '2000' },
        origin: { externalId: 'row-2', importBatchId: '5555' },
      },
    ]);

    expect(insert).toHaveBeenCalledWith(transactions);
    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ source: 'import', externalId: 'row-1', importBatchId: '5555' }),
      expect.objectContaining({ source: 'import', externalId: 'row-2', importBatchId: '5555' }),
    ]);
    expect(created).toHaveLength(2);
    expect(created.map((transaction) => transaction.externalId)).toEqual(['row-1', 'row-2']);
  });

  it('splits a batch above the chunk size into multiple inserts and concatenates the results', async () => {
    // Mirrors IMPORT_INSERT_CHUNK_SIZE (1000): one item over the boundary
    // forces a second insert call.
    const chunkSize = 1000;
    const itemCount = chunkSize + 1;
    const uuidFor = (i: number) => `44444444-4444-4444-8444-${i.toString().padStart(12, '0')}`;
    const firstChunkRows = Array.from({ length: chunkSize }, (_, i) =>
      transactionRow({
        id: uuidFor(i),
        source: 'import',
        externalId: `row-${i}`,
      }),
    );
    const secondChunkRows = [transactionRow({ source: 'import', externalId: `row-${chunkSize}` })];
    const { db, insert } = makeDb({ insertResults: [firstChunkRows, secondChunkRows] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const items = Array.from({ length: itemCount }, (_, i) => ({
      input: IMPORTED_INPUT,
      origin: { externalId: `row-${i}`, importBatchId: '5555' },
    }));

    const created = await repo.createImportedTransactions(items);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(itemCount);
  });
});

describe('ledgerRepository — refreshImportedTransaction', () => {
  it('updates the row and returns it, without ever writing editedAfterImport', async () => {
    const currentRow = transactionRow({ source: 'import', externalId: 'row-1' });
    const updatedRow = transactionRow({
      source: 'import',
      externalId: 'row-1',
      grossAmount: '1250',
    });
    const { db, update, updateSet } = makeDb({
      selectResults: [[currentRow]],
      updateResults: [[updatedRow]],
    });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const transaction = await repo.refreshImportedTransaction(TRANSACTION_ID, {
      ...IMPORTED_INPUT,
      grossAmount: '1250',
    });

    expect(update).toHaveBeenCalledWith(transactions);
    const setArg = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.hasOwn(setArg, 'editedAfterImport')).toBe(false);
    expect(transaction.grossAmount?.equals(Money.of('1250', currency('PLN')))).toBe(true);
  });
});

/**
 * `refreshImportedTransactions` doesn't `.returning()` its `UPDATE` — it
 * re-`SELECT`s the touched ids instead, since a `CASE`-keyed bulk update has
 * no per-row input to zip a `.returning()` result back against by anything
 * but `id`, which a plain re-select already gives for free. Own mock shape:
 * `update().set().where()` resolves to nothing, `select().from().where()`
 * (no `.limit()`) resolves to the chunk's rows, one resolution per chunk.
 */
function makeRefreshTransactionsDb(config: { selectResults: TransactionRow[][] }): {
  db: Database;
  update: Mock;
  updateSet: Mock;
  updateWhere: Mock;
  select: Mock;
  from: Mock;
  where: Mock;
} {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const where = vi.fn();
  for (const rows of config.selectResults) where.mockResolvedValueOnce(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return {
    db: { update, select } as unknown as Database,
    update,
    updateSet,
    updateWhere,
    select,
    from,
    where,
  };
}

describe('ledgerRepository — refreshImportedTransactions', () => {
  it('returns an empty array without touching the database when items is empty', async () => {
    const { db, update, select } = makeRefreshTransactionsDb({ selectResults: [] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const refreshed = await repo.refreshImportedTransactions([]);

    expect(refreshed).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('updates every item in one round trip and never writes editedAfterImport', async () => {
    const rowA = transactionRow({ source: 'import', externalId: 'row-1', grossAmount: '1250' });
    const rowB = transactionRow({
      id: '44444444-4444-4444-8444-444444444444',
      source: 'import',
      externalId: 'row-2',
      grossAmount: '2500',
    });
    const { db, update, updateSet } = makeRefreshTransactionsDb({ selectResults: [[rowA, rowB]] });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const refreshed = await repo.refreshImportedTransactions([
      { id: TRANSACTION_ID, input: { ...IMPORTED_INPUT, grossAmount: '1250' } },
      {
        id: transactionId('44444444-4444-4444-8444-444444444444'),
        input: { ...IMPORTED_INPUT, grossAmount: '2500' },
      },
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    const setArg = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.hasOwn(setArg, 'editedAfterImport')).toBe(false);
    expect(refreshed).toHaveLength(2);
    expect(refreshed[0]!.grossAmount?.equals(Money.of('1250', currency('PLN')))).toBe(true);
    expect(refreshed[1]!.grossAmount?.equals(Money.of('2500', currency('PLN')))).toBe(true);
  });

  it('splits a batch above the refresh chunk size into multiple update/select round trips', async () => {
    // Mirrors IMPORT_REFRESH_CHUNK_SIZE (500): one item over the boundary
    // forces a second update and a second re-select.
    const chunkSize = 500;
    const itemCount = chunkSize + 1;
    const uuidFor = (i: number) => `44444444-4444-4444-8444-${i.toString().padStart(12, '0')}`;
    const firstChunkRows = Array.from({ length: chunkSize }, (_, i) =>
      transactionRow({ id: uuidFor(i), source: 'import', externalId: `row-${i}` }),
    );
    const secondChunkRows = [transactionRow({ source: 'import', externalId: `row-${chunkSize}` })];
    const { db, update, select } = makeRefreshTransactionsDb({
      selectResults: [firstChunkRows, secondChunkRows],
    });
    const repo = ledgerRepository(db).forUser(USER_ID);

    const items = Array.from({ length: itemCount }, (_, i) => ({
      id: i === chunkSize ? TRANSACTION_ID : transactionId(uuidFor(i)),
      input: IMPORTED_INPUT,
    }));

    const refreshed = await repo.refreshImportedTransactions(items);

    expect(update).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledTimes(2);
    expect(refreshed).toHaveLength(itemCount);
  });
});

describe('instrumentRepository — search', () => {
  it('matches on symbol, name, or ISIN, not just symbol/name — the query BOŚ ISIN matching relies on', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    await instrumentRepository(db).search('US0378331005');

    const needle = '%US0378331005%';
    expect(where).toHaveBeenCalledWith(
      or(
        ilike(instruments.symbol, needle),
        ilike(instruments.name, needle),
        ilike(instruments.isin, needle),
      ),
    );
  });
});
