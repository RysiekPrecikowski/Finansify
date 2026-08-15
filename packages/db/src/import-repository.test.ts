import {
  accountId,
  currency,
  importBatchId,
  importRowId,
  Money,
  Temporal,
  transactionId,
  userId,
  type ImportRow,
  type ParsedRow,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { type Database } from './client';
import { importRepository } from './import-repository';
import { importBatches, type ImportBatchRow } from './schema/import-batches';
import { type ImportRowRow } from './schema/import-rows';

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
