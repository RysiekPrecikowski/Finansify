import {
  accountId,
  currency,
  importBatchId,
  importRowId,
  instrumentId,
  Money,
  Temporal,
  transactionId,
  userId,
  type ImportBatchId,
  type ImportRow,
  type ParsedRow,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { type Database } from './client';
import { importRepository } from './import-repository';
import { importBatches, type ImportBatchRow } from './schema/import-batches';
import { importRows, type ImportRowRow } from './schema/import-rows';

const USER_ID = userId('11111111-1111-4111-8111-111111111111');
const ACCOUNT_ID = accountId('22222222-2222-4222-8222-222222222222');
const BATCH_ID = importBatchId('33333333-3333-4333-8333-333333333333');

function batchRow(overrides: Partial<ImportBatchRow> = {}): ImportBatchRow {
  return {
    id: BATCH_ID,
    userId: USER_ID,
    accountId: ACCOUNT_ID,
    broker: 'xtb',
    blobKey: 'imports/22222222-2222-4222-8222-222222222222/1700000000000-statement.csv',
    status: 'pending',
    failureReason: null,
    totalRows: 0,
    acceptedRows: 0,
    rejectedRows: 0,
    duplicateRows: 0,
    warnings: [],
    uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Mocks only the chain shapes `import-repository.ts` actually calls — same
 * rationale as `users.test.ts`'s `makeDb()`. Three independent chains here
 * rather than one: `select().from().where().limit()` for `requireOwnBatch`,
 * `insert(table).values(...).returning()` for `createBatch`/`createRows`, and
 * `update(table).set(...).where(...).returning()` for
 * `markBatchParsed`/`markBatchFailed`. Each is fed its resolved values in call
 * order via `mockResolvedValueOnce`, so a test that expects two selects (say)
 * passes two arrays.
 */
function makeDb(config: {
  selectResults?: ImportBatchRow[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
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

function rowRow(overrides: Partial<ImportRowRow> = {}): ImportRowRow {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    batchId: BATCH_ID,
    rowIndex: 0,
    parsed: expectedSerialized(fullRow()),
    status: 'pending',
    transactionId: null,
    resolvedInstrumentId: null,
    rejectionReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * `rowsForBatch` chains `.orderBy()` off `.where()` rather than `.limit()` —
 * a different shape than every other query in this file — so it needs its own
 * mock rather than `makeDb`'s. The ownership check (`requireOwnBatch`) still
 * runs first and still chains `.limit()`, so `where()` here answers both.
 */
function makeRowsForBatchDb(config: { ownerRows: ImportBatchRow[]; rows?: ImportRowRow[] }): {
  db: Database;
  select: Mock;
  where: Mock;
  orderBy: Mock;
} {
  const limit = vi.fn().mockResolvedValueOnce(config.ownerRows);
  const orderBy = vi.fn().mockResolvedValueOnce(config.rows ?? []);
  const where = vi.fn().mockReturnValue({ limit, orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as Database, select, where, orderBy };
}

/**
 * Mirrors `resolveInstruments`'s own per-resolution `WHERE` construction
 * exactly (`import-repository.ts`), so a test can assert the adapter built
 * the right clause without re-deriving drizzle's `SQL` internals by hand —
 * same rationale as `expectedSerialized` above.
 */
function resolutionWhereClause(batchId: ImportBatchId, symbol: string, exchange: string | null) {
  const exchangeMatch =
    exchange === null
      ? sql`(${importRows.parsed}->'instrument'->>'exchange') IS NULL`
      : sql`(${importRows.parsed}->'instrument'->>'exchange') = ${exchange}`;
  return and(
    eq(importRows.batchId, batchId),
    sql`(${importRows.parsed}->'instrument'->>'symbol') = ${symbol}`,
    exchangeMatch,
  );
}

/** Every optional field populated — exercises the non-null branch of every `?? null` in (de)serialization. */
function fullRow(): ParsedRow {
  return {
    externalId: 'ext-1',
    instrument: { symbol: 'AAPL', exchange: 'NASDAQ', name: 'Apple Inc.' },
    type: 'buy',
    tradeDate: Temporal.PlainDate.from('2024-01-10'),
    settleDate: Temporal.PlainDate.from('2024-01-12'),
    quantity: new Decimal('10.5'),
    price: Money.of('100.25', currency('USD')),
    grossAmount: Money.of('1052.63', currency('USD')),
    fee: Money.of('1.99', currency('USD')),
    tax: Money.of('0.75', currency('USD')),
    currency: currency('USD'),
    fxRate: new Decimal('4.0512'),
    fxRateSource: 'broker',
    note: 'partial fill',
    warnings: ['inferred an fx rate from the statement total'],
  };
}

/** Every optional field null — exercises the null branch of every `?? null`. */
function nullRow(): ParsedRow {
  return {
    externalId: 'ext-2',
    instrument: null,
    type: 'deposit',
    tradeDate: Temporal.PlainDate.from('2024-01-11'),
    settleDate: null,
    quantity: new Decimal('0'),
    price: null,
    grossAmount: Money.of('1000', currency('PLN')),
    fee: Money.of('0', currency('PLN')),
    tax: Money.of('0', currency('PLN')),
    currency: currency('PLN'),
    fxRate: null,
    fxRateSource: null,
    note: null,
    warnings: [],
  };
}

/** The exact shape `serializeParsedRow` (private to `import-repository.ts`) is documented to produce. */
function expectedSerialized(row: ParsedRow): Record<string, unknown> {
  return {
    externalId: row.externalId,
    instrument: row.instrument,
    type: row.type,
    tradeDate: row.tradeDate.toString(),
    settleDate: row.settleDate?.toString() ?? null,
    quantity: row.quantity.toString(),
    price: row.price?.amount.toString() ?? null,
    grossAmount: row.grossAmount?.amount.toString() ?? null,
    fee: row.fee.amount.toString(),
    tax: row.tax.amount.toString(),
    currency: row.currency,
    fxRate: row.fxRate?.toString() ?? null,
    fxRateSource: row.fxRateSource,
    note: row.note,
    warnings: [...row.warnings],
  };
}

function expectParsedRowsEqual(actual: ParsedRow, expected: ParsedRow): void {
  expect(actual.externalId).toBe(expected.externalId);
  expect(actual.instrument).toEqual(expected.instrument);
  expect(actual.type).toBe(expected.type);
  expect(actual.tradeDate.equals(expected.tradeDate)).toBe(true);
  expect(actual.settleDate === null).toBe(expected.settleDate === null);
  if (actual.settleDate !== null && expected.settleDate !== null) {
    expect(actual.settleDate.equals(expected.settleDate)).toBe(true);
  }
  expect(actual.quantity.equals(expected.quantity)).toBe(true);
  expect(actual.price === null).toBe(expected.price === null);
  if (actual.price !== null && expected.price !== null) {
    expect(actual.price.equals(expected.price)).toBe(true);
  }
  expect(actual.grossAmount === null).toBe(expected.grossAmount === null);
  if (actual.grossAmount !== null && expected.grossAmount !== null) {
    expect(actual.grossAmount.equals(expected.grossAmount)).toBe(true);
  }
  expect(actual.fee.equals(expected.fee)).toBe(true);
  expect(actual.tax.equals(expected.tax)).toBe(true);
  expect(actual.currency).toBe(expected.currency);
  expect(actual.fxRate === null).toBe(expected.fxRate === null);
  if (actual.fxRate !== null && expected.fxRate !== null) {
    expect(actual.fxRate.equals(expected.fxRate)).toBe(true);
  }
  expect(actual.fxRateSource).toBe(expected.fxRateSource);
  expect(actual.note).toBe(expected.note);
  expect(actual.warnings).toEqual(expected.warnings);
}

describe('importRepository — createBatch', () => {
  it('inserts with the right userId/accountId/broker/blobKey and maps the returned row into a full ImportBatch', async () => {
    const row = batchRow();
    const { db, insert, insertValues } = makeDb({ insertResults: [[row]] });
    const repo = importRepository(db).forUser(USER_ID);

    const batch = await repo.createBatch({
      accountId: ACCOUNT_ID,
      broker: 'xtb',
      blobKey: row.blobKey,
    });

    expect(insert).toHaveBeenCalledWith(importBatches);
    expect(insertValues).toHaveBeenCalledWith({
      userId: USER_ID,
      accountId: ACCOUNT_ID,
      broker: 'xtb',
      blobKey: row.blobKey,
    });

    expect(batch).toEqual({
      id: importBatchId(row.id),
      accountId: accountId(row.accountId),
      broker: row.broker,
      blobKey: row.blobKey,
      status: row.status,
      failureReason: row.failureReason,
      totalRows: row.totalRows,
      acceptedRows: row.acceptedRows,
      rejectedRows: row.rejectedRows,
      duplicateRows: row.duplicateRows,
      warnings: [],
      uploadedAt: Temporal.Instant.fromEpochMilliseconds(row.uploadedAt.getTime()),
    });
    expect(batch.uploadedAt).toBeInstanceOf(Temporal.Instant);
  });
});

describe('importRepository — markBatchParsed / markBatchFailed', () => {
  it('markBatchParsed checks ownership via a scoped select before updating', async () => {
    const existing = batchRow();
    const updated = batchRow({ status: 'parsed', totalRows: 5, warnings: ['w1'] });
    const { db, select, from, update } = makeDb({
      selectResults: [[existing]],
      updateResults: [[updated]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    await repo.markBatchParsed(BATCH_ID, { totalRows: 5, warnings: ['w1'] });

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(importBatches);
    expect(update).toHaveBeenCalledTimes(1);
    // The ownership select happens before the update — proven by call order on the shared mocks.
    const selectOrder = select.mock.invocationCallOrder[0]!;
    const updateOrder = update.mock.invocationCallOrder[0]!;
    expect(selectOrder).toBeLessThan(updateOrder);
  });

  it('markBatchParsed throws without updating when the batch does not belong to this user (or does not exist)', async () => {
    const { db, update } = makeDb({ selectResults: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.markBatchParsed(BATCH_ID, { totalRows: 1, warnings: [] })).rejects.toThrow(
      `No import batch ${BATCH_ID}`,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('markBatchParsed sets status parsed, totalRows, and the given warnings', async () => {
    const existing = batchRow();
    const updated = batchRow({ status: 'parsed', totalRows: 7, warnings: ['a warning'] });
    const { db, updateSet } = makeDb({ selectResults: [[existing]], updateResults: [[updated]] });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.markBatchParsed(BATCH_ID, { totalRows: 7, warnings: ['a warning'] });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'parsed', totalRows: 7, warnings: ['a warning'] }),
    );
    expect(result.status).toBe('parsed');
    expect(result.totalRows).toBe(7);
    expect(result.warnings).toEqual(['a warning']);
  });

  it('markBatchFailed throws without updating when the batch does not belong to this user (or does not exist)', async () => {
    const { db, update } = makeDb({ selectResults: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.markBatchFailed(BATCH_ID, 'boom')).rejects.toThrow(
      `No import batch ${BATCH_ID}`,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('markBatchFailed sets status failed and the given failureReason', async () => {
    const existing = batchRow();
    const updated = batchRow({ status: 'failed', failureReason: 'parser blew up' });
    const { db, updateSet } = makeDb({ selectResults: [[existing]], updateResults: [[updated]] });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.markBatchFailed(BATCH_ID, 'parser blew up');

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failureReason: 'parser blew up' }),
    );
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('parser blew up');
  });
});

describe('importRepository — createRows', () => {
  it('checks ownership via a scoped select before inserting', async () => {
    const { db, select } = makeDb({ selectResults: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.createRows(BATCH_ID, [fullRow()])).rejects.toThrow(
      `No import batch ${BATCH_ID}`,
    );
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('returns [] without issuing an insert for an empty array, after still checking ownership', async () => {
    const existing = batchRow();
    const { db, select, insert } = makeDb({ selectResults: [[existing]] });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.createRows(BATCH_ID, []);

    expect(result).toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("assigns rowIndex as each row's 0-based array position and sends the exact serialized shape to insert", async () => {
    const existing = batchRow();
    const rowA = fullRow();
    const rowB = nullRow();
    const { db, insertValues } = makeDb({
      selectResults: [[existing]],
      insertResults: [[]], // return value not used by this test
    });
    const repo = importRepository(db).forUser(USER_ID);

    await repo.createRows(BATCH_ID, [rowA, rowB]);

    expect(insertValues).toHaveBeenCalledWith([
      { batchId: BATCH_ID, rowIndex: 0, parsed: expectedSerialized(rowA) },
      { batchId: BATCH_ID, rowIndex: 1, parsed: expectedSerialized(rowB) },
    ]);
  });

  it('round-trips a fully-populated ParsedRow and a fully-null ParsedRow through serialize/deserialize', async () => {
    const existing = batchRow();
    const rowA = fullRow();
    const rowB = nullRow();

    const insertedRowA: ImportRowRow = {
      id: '44444444-4444-4444-8444-444444444444',
      batchId: BATCH_ID,
      rowIndex: 0,
      parsed: expectedSerialized(rowA),
      status: 'pending',
      transactionId: null,
      resolvedInstrumentId: null,
      rejectionReason: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const insertedRowB: ImportRowRow = {
      id: '55555555-5555-4555-8555-555555555555',
      batchId: BATCH_ID,
      rowIndex: 1,
      parsed: expectedSerialized(rowB),
      status: 'accepted',
      transactionId: '66666666-6666-4666-8666-666666666666',
      resolvedInstrumentId: null,
      rejectionReason: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const { db } = makeDb({
      selectResults: [[existing]],
      insertResults: [[insertedRowA, insertedRowB]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    const created: readonly ImportRow[] = await repo.createRows(BATCH_ID, [rowA, rowB]);

    expect(created).toHaveLength(2);
    expect(created[0]!.id).toBe(importRowId(insertedRowA.id));
    expect(created[0]!.batchId).toBe(BATCH_ID);
    expect(created[0]!.rowIndex).toBe(0);
    expect(created[0]!.status).toBe('pending');
    expect(created[0]!.transactionId).toBeNull();
    expectParsedRowsEqual(created[0]!.parsed, rowA);

    expect(created[1]!.id).toBe(importRowId(insertedRowB.id));
    expect(created[1]!.rowIndex).toBe(1);
    expect(created[1]!.status).toBe('accepted');
    expect(created[1]!.transactionId).toBe(transactionId(insertedRowB.transactionId!));
    expectParsedRowsEqual(created[1]!.parsed, rowB);
  });
});

describe('importRepository — getBatch', () => {
  it('returns the batch mapped from the row when it is found and owned by this user', async () => {
    const row = batchRow({ status: 'parsed', totalRows: 3 });
    const { db, select } = makeDb({ selectResults: [[row]] });
    const repo = importRepository(db).forUser(USER_ID);

    const batch = await repo.getBatch(BATCH_ID);

    expect(select).toHaveBeenCalledTimes(1);
    expect(batch).toEqual({
      id: importBatchId(row.id),
      accountId: accountId(row.accountId),
      broker: row.broker,
      blobKey: row.blobKey,
      status: row.status,
      failureReason: row.failureReason,
      totalRows: row.totalRows,
      acceptedRows: row.acceptedRows,
      rejectedRows: row.rejectedRows,
      duplicateRows: row.duplicateRows,
      warnings: row.warnings,
      uploadedAt: Temporal.Instant.fromEpochMilliseconds(row.uploadedAt.getTime()),
    });
  });

  // The scoped `WHERE` filters on `userId` and `id` together, so a batch
  // belonging to another user comes back as the same empty result set as one
  // that never existed — both reach this branch, never the ownership throw
  // every other batch-id method here uses.
  it('resolves null, without throwing, for a batch that exists but belongs to another user', async () => {
    const { db } = makeDb({ selectResults: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.getBatch(BATCH_ID)).resolves.toBeNull();
  });

  it('resolves null, without throwing, for a batch id that does not exist at all', async () => {
    const { db } = makeDb({ selectResults: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.getBatch(BATCH_ID)).resolves.toBeNull();
  });
});

describe('importRepository — rowsForBatch', () => {
  it('throws without querying rows when the batch is not owned by this user (or does not exist)', async () => {
    const { db, where } = makeRowsForBatchDb({ ownerRows: [] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.rowsForBatch(BATCH_ID)).rejects.toThrow(`No import batch ${BATCH_ID}`);
    // Only the ownership check's own `.where()` ran — the rows query never got issued.
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('returns every row for the batch, mapped and in rowIndex order, ordered by importRows.rowIndex', async () => {
    const owner = batchRow();
    const rowA = rowRow({ id: '88888888-8888-4888-8888-888888888888', rowIndex: 0 });
    const rowB = rowRow({
      id: '99999999-9999-4999-8999-999999999999',
      rowIndex: 1,
      status: 'accepted',
      resolvedInstrumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const { db, orderBy } = makeRowsForBatchDb({ ownerRows: [owner], rows: [rowA, rowB] });
    const repo = importRepository(db).forUser(USER_ID);

    const rows = await repo.rowsForBatch(BATCH_ID);

    expect(orderBy).toHaveBeenCalledWith(importRows.rowIndex);
    expect(rows.map((row) => row.rowIndex)).toEqual([0, 1]);
    expect(rows[0]!.id).toBe(importRowId(rowA.id));
    expect(rows[1]!.resolvedInstrumentId).toBe(instrumentId(rowB.resolvedInstrumentId!));
  });
});

describe('importRepository — resolveInstruments', () => {
  it('checks ownership via a scoped select before updating', async () => {
    const { db, select, update } = makeDb({ selectResults: [[]] });
    const repo = importRepository(db).forUser(USER_ID);
    const target = instrumentId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    await expect(
      repo.resolveInstruments(BATCH_ID, [{ symbol: 'AAPL', exchange: null, instrumentId: target }]),
    ).rejects.toThrow(`No import batch ${BATCH_ID}`);
    expect(select).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns [] without issuing any update for an empty resolutions array, after still checking ownership', async () => {
    const existing = batchRow();
    const { db, select, update } = makeDb({ selectResults: [[existing]] });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.resolveInstruments(BATCH_ID, []);

    expect(result).toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('issues exactly one UPDATE per resolution — a handful of tickers, not one per row', async () => {
    const existing = batchRow();
    const target = instrumentId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const { db, update, updateReturning } = makeDb({
      selectResults: [[existing]],
      updateResults: [[rowRow({ rowIndex: 0 })], [rowRow({ rowIndex: 1 })]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    await repo.resolveInstruments(BATCH_ID, [
      { symbol: 'AAPL', exchange: 'NASDAQ', instrumentId: target },
      { symbol: 'MSFT', exchange: null, instrumentId: target },
    ]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(updateReturning).toHaveBeenCalledTimes(2);
  });

  it("builds each resolution's WHERE clause from that resolution's own (symbol, exchange) — a null exchange produces an IS NULL check, not a wildcard match", async () => {
    const existing = batchRow();
    const target = instrumentId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const { db, updateWhere } = makeDb({
      selectResults: [[existing]],
      updateResults: [[rowRow({ rowIndex: 0 })], [rowRow({ rowIndex: 1 })]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    await repo.resolveInstruments(BATCH_ID, [
      { symbol: 'AAPL', exchange: 'NASDAQ', instrumentId: target },
      { symbol: 'MSFT', exchange: null, instrumentId: target },
    ]);

    expect(updateWhere).toHaveBeenNthCalledWith(
      1,
      resolutionWhereClause(BATCH_ID, 'AAPL', 'NASDAQ'),
    );
    expect(updateWhere).toHaveBeenNthCalledWith(2, resolutionWhereClause(BATCH_ID, 'MSFT', null));
  });

  it('sets resolvedInstrumentId on every matching row and returns the union of rows touched across all resolutions', async () => {
    const existing = batchRow();
    const target = instrumentId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const touchedByFirst = rowRow({
      id: '88888888-8888-4888-8888-888888888888',
      rowIndex: 0,
      resolvedInstrumentId: target,
    });
    const touchedBySecond = rowRow({
      id: '99999999-9999-4999-8999-999999999999',
      rowIndex: 1,
      resolvedInstrumentId: target,
    });
    const { db, updateSet } = makeDb({
      selectResults: [[existing]],
      updateResults: [[touchedByFirst], [touchedBySecond]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.resolveInstruments(BATCH_ID, [
      { symbol: 'AAPL', exchange: 'NASDAQ', instrumentId: target },
      { symbol: 'MSFT', exchange: null, instrumentId: target },
    ]);

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedInstrumentId: target }),
    );
    expect(result).toHaveLength(2);
    expect(result.map((row) => row.id)).toEqual([
      importRowId(touchedByFirst.id),
      importRowId(touchedBySecond.id),
    ]);
    expect(result.every((row) => row.resolvedInstrumentId === target)).toBe(true);
  });
});

const ROW_ID = importRowId('77777777-7777-4777-8777-777777777777');
const OUTCOME_TRANSACTION_ID = transactionId('66666666-6666-4666-8666-666666666666');

/**
 * `getRow`/`recordRowOutcome` both join `import_rows` to `import_batches` to
 * check ownership (`import-repository.ts`), rather than the plain
 * `select().from().where().limit()` shape `makeDb` mocks — a different chain
 * needs a different mock, same rationale as `makeRowsForBatchDb` above.
 */
function makeJoinedRowDb(config: {
  selectRows: { row: ImportRowRow }[][];
  updateResults?: ImportRowRow[][];
}): {
  db: Database;
  select: Mock;
  from: Mock;
  innerJoin: Mock;
  selectWhere: Mock;
  limit: Mock;
  update: Mock;
  updateSet: Mock;
  updateWhere: Mock;
  updateReturning: Mock;
} {
  const limit = vi.fn();
  for (const rows of config.selectRows) limit.mockResolvedValueOnce(rows);
  const selectWhere = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where: selectWhere });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });

  const updateReturning = vi.fn();
  for (const rows of config.updateResults ?? []) updateReturning.mockResolvedValueOnce(rows);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    db: { select, update } as unknown as Database,
    select,
    from,
    innerJoin,
    selectWhere,
    limit,
    update,
    updateSet,
    updateWhere,
    updateReturning,
  };
}

describe('importRepository — getRow', () => {
  it('returns the row mapped from the joined result when it is found and owned by this user', async () => {
    const row = rowRow({ id: ROW_ID });
    const { db, select } = makeJoinedRowDb({ selectRows: [[{ row }]] });
    const repo = importRepository(db).forUser(USER_ID);

    const found = await repo.getRow(ROW_ID);

    expect(select).toHaveBeenCalledTimes(1);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(ROW_ID);
    expect(found!.batchId).toBe(BATCH_ID);
  });

  // The inner join filters on `import_batches.user_id`, so a row that exists
  // but belongs to another user's batch comes back as the same empty result
  // set as an id that does not exist at all — same convention as `getBatch`
  // above.
  it("resolves null, without throwing, for a row that exists but belongs to another user's batch", async () => {
    const { db } = makeJoinedRowDb({ selectRows: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.getRow(ROW_ID)).resolves.toBeNull();
  });

  it('resolves null, without throwing, for a row id that does not exist at all', async () => {
    const { db } = makeJoinedRowDb({ selectRows: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(repo.getRow(ROW_ID)).resolves.toBeNull();
  });
});

describe('importRepository — recordRowOutcome', () => {
  it('throws without updating when the row does not belong to this user (or does not exist)', async () => {
    const { db, update } = makeJoinedRowDb({ selectRows: [[]] });
    const repo = importRepository(db).forUser(USER_ID);

    await expect(
      repo.recordRowOutcome(ROW_ID, { status: 'accepted', transactionId: OUTCOME_TRANSACTION_ID }),
    ).rejects.toThrow(`No import row ${ROW_ID}`);
    expect(update).not.toHaveBeenCalled();
  });

  it('sets status and transactionId and clears rejectionReason to null for an accepted outcome', async () => {
    const owned = rowRow({ id: ROW_ID });
    const updated = rowRow({
      id: ROW_ID,
      status: 'accepted',
      transactionId: OUTCOME_TRANSACTION_ID,
      rejectionReason: null,
    });
    const { db, updateSet } = makeJoinedRowDb({
      selectRows: [[{ row: owned }]],
      updateResults: [[updated]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.recordRowOutcome(ROW_ID, {
      status: 'accepted',
      transactionId: OUTCOME_TRANSACTION_ID,
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        transactionId: OUTCOME_TRANSACTION_ID,
        rejectionReason: null,
      }),
    );
    expect(result.status).toBe('accepted');
    expect(result.transactionId).toBe(OUTCOME_TRANSACTION_ID);
    expect(result.rejectionReason).toBeNull();
  });

  it('sets status, transactionId, and rejectionReason for a duplicate outcome', async () => {
    const owned = rowRow({ id: ROW_ID });
    const updated = rowRow({
      id: ROW_ID,
      status: 'duplicate',
      transactionId: OUTCOME_TRANSACTION_ID,
      rejectionReason: 'edited by hand since import',
    });
    const { db, updateSet } = makeJoinedRowDb({
      selectRows: [[{ row: owned }]],
      updateResults: [[updated]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.recordRowOutcome(ROW_ID, {
      status: 'duplicate',
      transactionId: OUTCOME_TRANSACTION_ID,
      reason: 'edited by hand since import',
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'duplicate',
        transactionId: OUTCOME_TRANSACTION_ID,
        rejectionReason: 'edited by hand since import',
      }),
    );
    expect(result.status).toBe('duplicate');
    expect(result.rejectionReason).toBe('edited by hand since import');
  });

  it('sets rejectionReason and clears transactionId to null for a rejected outcome', async () => {
    const owned = rowRow({ id: ROW_ID, transactionId: OUTCOME_TRANSACTION_ID });
    const updated = rowRow({
      id: ROW_ID,
      status: 'rejected',
      transactionId: null,
      rejectionReason: 'some reason',
    });
    const { db, updateSet } = makeJoinedRowDb({
      selectRows: [[{ row: owned }]],
      updateResults: [[updated]],
    });
    const repo = importRepository(db).forUser(USER_ID);

    const result = await repo.recordRowOutcome(ROW_ID, {
      status: 'rejected',
      reason: 'some reason',
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        transactionId: null,
        rejectionReason: 'some reason',
      }),
    );
    expect(result.status).toBe('rejected');
    expect(result.transactionId).toBeNull();
    expect(result.rejectionReason).toBe('some reason');
  });
});
