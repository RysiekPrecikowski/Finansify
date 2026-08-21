import { currency, instrumentId, Temporal } from '@finansify/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { type Database } from './client';
import { fxRateRepository, marketPriceRepository, symbolRepository } from './price-repository';
import {
  fxRateCoverage,
  instrumentPriceCoverage,
  type FxRateCoverageRow,
  type FxRateRow,
  type InstrumentPriceCoverageRow,
  type InstrumentPriceRow,
} from './schema/prices';

const INSTRUMENT_ID_1 = instrumentId('66666666-6666-4666-8666-666666666666');
const INSTRUMENT_ID_2 = instrumentId('77777777-7777-4777-8777-777777777777');
const USD = currency('USD');
const FETCHED_AT = new Date('2026-01-01T00:00:00.000Z');

function instrumentPriceRow(overrides: Partial<InstrumentPriceRow> = {}): InstrumentPriceRow {
  return {
    instrumentId: INSTRUMENT_ID_1,
    date: '2026-01-05',
    close: '100.00000000',
    currency: 'PLN',
    source: 'yahoo',
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

function fxRateRow(overrides: Partial<FxRateRow> = {}): FxRateRow {
  return {
    currency: 'USD',
    date: '2026-01-05',
    mid: '4.00000000',
    source: 'nbp',
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

function instrumentPriceCoverageRow(
  overrides: Partial<InstrumentPriceCoverageRow> = {},
): InstrumentPriceCoverageRow {
  return {
    instrumentId: INSTRUMENT_ID_1,
    source: 'yahoo',
    coveredFrom: '2020-01-01',
    checkedAt: FETCHED_AT,
    ...overrides,
  };
}

function fxRateCoverageRow(overrides: Partial<FxRateCoverageRow> = {}): FxRateCoverageRow {
  return {
    currency: 'USD',
    source: 'nbp',
    coveredFrom: '2020-01-01',
    checkedAt: FETCHED_AT,
    ...overrides,
  };
}

/**
 * The exact `SQL` fragment `markCovered` builds for its `LEAST(...)` widen —
 * reconstructed with the same drizzle helpers so a test can assert the
 * built object without re-deriving drizzle's `SQL` internals by hand, same
 * technique as `expectedFindByExternalIdWhere` in `ledger-repository.test.ts`.
 */
function expectedLeastCoveredFrom(column: PgColumn) {
  return sql`LEAST(${column}, excluded.covered_from)`;
}

/**
 * A `select()`/`selectDistinctOn()`-style chain terminating in `.orderBy()`,
 * which `historyFor` uses for both the anchor query and the bucketed
 * (non-`day`) range query. Each call to the top-level function consumes the
 * next queued resolution, in call order — same pattern as `makeDb`'s `limit`
 * queue in `ledger-repository.test.ts`.
 */
function makeOrderedSelectChain<Row>(rowsQueue: Row[][]) {
  const orderBy = vi.fn();
  for (const rows of rowsQueue) orderBy.mockResolvedValueOnce(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const fn = vi.fn().mockReturnValue({ from });
  return { fn, from, where, orderBy };
}

/** A `select().from().where()` chain that resolves directly — `coverageFor`'s shape, no `.orderBy()`. */
function makeWhereResolvedSelectChain<Row>(rows: Row[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const fn = vi.fn().mockReturnValue({ from });
  return { fn, from, where };
}

/** An `insert().values().onConflictDoUpdate()` chain — `markCovered`'s shape. */
function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate };
}

describe('marketPriceRepository — historyFor', () => {
  function makeHistoryDb(config: {
    anchorRows?: InstrumentPriceRow[];
    dayRangeRows?: InstrumentPriceRow[];
    bucketedRangeRows?: InstrumentPriceRow[];
  }): {
    db: Database;
    selectDistinctOn: Mock;
    select: Mock;
  } {
    // First `selectDistinctOn` call is always the anchor query. A second one
    // (week/month grain only) is the bucketed range query.
    const distinctQueue: InstrumentPriceRow[][] = [config.anchorRows ?? []];
    if (config.bucketedRangeRows) distinctQueue.push(config.bucketedRangeRows);
    const distinct = makeOrderedSelectChain(distinctQueue);

    const plain = makeOrderedSelectChain(config.dayRangeRows ? [config.dayRangeRows] : []);

    return {
      db: { selectDistinctOn: distinct.fn, select: plain.fn } as unknown as Database,
      selectDistinctOn: distinct.fn,
      select: plain.fn,
    };
  }

  it('merges the anchor row (oldest) ahead of the in-range rows, ascending, for a day grain', async () => {
    const anchor = instrumentPriceRow({ date: '2025-12-31', close: '90.00000000' });
    const rangeOld = instrumentPriceRow({ date: '2026-01-02', close: '95.00000000' });
    const rangeNew = instrumentPriceRow({ date: '2026-01-08', close: '105.00000000' });
    const { db } = makeHistoryDb({ anchorRows: [anchor], dayRangeRows: [rangeNew, rangeOld] });
    const repo = marketPriceRepository(db);

    const result = await repo.historyFor(
      [INSTRUMENT_ID_1],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'yahoo',
    );

    const bars = result.get(INSTRUMENT_ID_1);
    expect(bars).toBeDefined();
    expect(bars!.map((bar) => bar.date.toString())).toEqual([
      '2025-12-31',
      '2026-01-02',
      '2026-01-08',
    ]);
    expect(bars![0]!.close.amount.toString()).toBe('90');
  });

  it('takes the plain select() path for grain "day" — selectDistinctOn called once (anchor only)', async () => {
    const { db, selectDistinctOn, select } = makeHistoryDb({
      anchorRows: [instrumentPriceRow({ date: '2025-12-31' })],
      dayRangeRows: [instrumentPriceRow({ date: '2026-01-02' })],
    });
    const repo = marketPriceRepository(db);

    await repo.historyFor(
      [INSTRUMENT_ID_1],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'yahoo',
    );

    expect(selectDistinctOn).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('takes the selectDistinctOn() bucketed path for grain "week" — selectDistinctOn called twice (anchor + range), select() never called', async () => {
    const { db, selectDistinctOn, select } = makeHistoryDb({
      anchorRows: [instrumentPriceRow({ date: '2025-12-31' })],
      bucketedRangeRows: [instrumentPriceRow({ date: '2026-01-02' })],
    });
    const repo = marketPriceRepository(db);

    await repo.historyFor(
      [INSTRUMENT_ID_1],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'week',
      'yahoo',
    );

    expect(selectDistinctOn).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
  });

  it('leaves an id with no anchor and no in-range rows absent from the result map entirely', async () => {
    const { db } = makeHistoryDb({
      anchorRows: [instrumentPriceRow({ instrumentId: INSTRUMENT_ID_1, date: '2025-12-31' })],
      dayRangeRows: [instrumentPriceRow({ instrumentId: INSTRUMENT_ID_1, date: '2026-01-02' })],
    });
    const repo = marketPriceRepository(db);

    const result = await repo.historyFor(
      [INSTRUMENT_ID_1, INSTRUMENT_ID_2],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'yahoo',
    );

    expect(result.has(INSTRUMENT_ID_1)).toBe(true);
    expect(result.has(INSTRUMENT_ID_2)).toBe(false);
    expect(result.size).toBe(1);
  });

  it('returns an empty map without querying when ids is empty', async () => {
    const { db, selectDistinctOn, select } = makeHistoryDb({});
    const repo = marketPriceRepository(db);

    const result = await repo.historyFor(
      [],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'yahoo',
    );

    expect(result.size).toBe(0);
    expect(selectDistinctOn).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe('marketPriceRepository — coverageFor', () => {
  it('returns an empty map without querying when ids is empty', async () => {
    const { fn: select } = makeWhereResolvedSelectChain<InstrumentPriceCoverageRow>([]);
    const db = { select } as unknown as Database;
    const repo = marketPriceRepository(db);

    const result = await repo.coverageFor([], 'yahoo');

    expect(result.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it('maps coveredFrom back to a Temporal.PlainDate, not the raw string', async () => {
    const row = instrumentPriceCoverageRow({ coveredFrom: '2019-06-15' });
    const { fn: select } = makeWhereResolvedSelectChain([row]);
    const db = { select } as unknown as Database;
    const repo = marketPriceRepository(db);

    const result = await repo.coverageFor([INSTRUMENT_ID_1], 'yahoo');

    const covered = result.get(INSTRUMENT_ID_1);
    expect(covered).toBeInstanceOf(Temporal.PlainDate);
    expect(covered!.equals(Temporal.PlainDate.from('2019-06-15'))).toBe(true);
  });

  it('scopes the query to the given ids and source', async () => {
    const { fn: select, where } = makeWhereResolvedSelectChain<InstrumentPriceCoverageRow>([]);
    const db = { select } as unknown as Database;
    const repo = marketPriceRepository(db);

    await repo.coverageFor([INSTRUMENT_ID_1, INSTRUMENT_ID_2], 'yahoo');

    expect(where).toHaveBeenCalledWith(
      and(
        inArray(instrumentPriceCoverage.instrumentId, [INSTRUMENT_ID_1, INSTRUMENT_ID_2]),
        eq(instrumentPriceCoverage.source, 'yahoo'),
      ),
    );
  });
});

describe('marketPriceRepository — markCovered', () => {
  it('never touches the database when ids is empty', async () => {
    const { insert } = makeInsertChain();
    const db = { insert } as unknown as Database;
    const repo = marketPriceRepository(db);

    await repo.markCovered([], 'yahoo', Temporal.PlainDate.from('2020-01-01'));

    expect(insert).not.toHaveBeenCalled();
  });

  it('sets coveredFrom to LEAST(existing, excluded) — a narrowing update is never constructed', async () => {
    const { insert, values, onConflictDoUpdate } = makeInsertChain();
    const db = { insert } as unknown as Database;
    const repo = marketPriceRepository(db);

    await repo.markCovered([INSTRUMENT_ID_1], 'yahoo', Temporal.PlainDate.from('2020-01-01'));

    expect(insert).toHaveBeenCalledWith(instrumentPriceCoverage);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        instrumentId: INSTRUMENT_ID_1,
        source: 'yahoo',
        coveredFrom: '2020-01-01',
      }),
    ]);
    const call = onConflictDoUpdate.mock.calls[0]![0] as {
      target: unknown;
      set: { coveredFrom: unknown };
    };
    expect(call.target).toEqual([
      instrumentPriceCoverage.instrumentId,
      instrumentPriceCoverage.source,
    ]);
    // The exact SQL fragment the widen-only guarantee rests on: whatever value
    // is already stored, the new row can only ever move coveredFrom earlier.
    expect(call.set.coveredFrom).toEqual(
      expectedLeastCoveredFrom(instrumentPriceCoverage.coveredFrom),
    );
  });
});

describe('fxRateRepository — historyFor (currency-keyed, source-filtered)', () => {
  function makeFxHistoryDb(config: {
    anchorRows?: FxRateRow[];
    dayRangeRows?: FxRateRow[];
    bucketedRangeRows?: FxRateRow[];
  }): { db: Database; selectDistinctOn: Mock; select: Mock } {
    const distinctQueue: FxRateRow[][] = [config.anchorRows ?? []];
    if (config.bucketedRangeRows) distinctQueue.push(config.bucketedRangeRows);
    const distinct = makeOrderedSelectChain(distinctQueue);
    const plain = makeOrderedSelectChain(config.dayRangeRows ? [config.dayRangeRows] : []);
    return {
      db: { selectDistinctOn: distinct.fn, select: plain.fn } as unknown as Database,
      selectDistinctOn: distinct.fn,
      select: plain.fn,
    };
  }

  it('merges the anchor rate (oldest) ahead of the in-range rates, ascending', async () => {
    const anchor = fxRateRow({ date: '2025-12-31', mid: '3.90000000' });
    const inRange = fxRateRow({ date: '2026-01-05', mid: '4.00000000' });
    const { db } = makeFxHistoryDb({ anchorRows: [anchor], dayRangeRows: [inRange] });
    const repo = fxRateRepository(db);

    const result = await repo.historyFor(
      [USD],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'nbp',
    );

    const series = result.get(USD);
    expect(series).toBeDefined();
    expect(series!.map((rate) => rate.date.toString())).toEqual(['2025-12-31', '2026-01-05']);
    expect(series![0]!.mid.toString()).toBe('3.9');
  });

  it('grain "week" calls selectDistinctOn twice (anchor + bucketed range) and never plain select()', async () => {
    const { db, selectDistinctOn, select } = makeFxHistoryDb({
      anchorRows: [fxRateRow({ date: '2025-12-31' })],
      bucketedRangeRows: [fxRateRow({ date: '2026-01-05' })],
    });
    const repo = fxRateRepository(db);

    await repo.historyFor(
      [USD],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'week',
      'nbp',
    );

    expect(selectDistinctOn).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
  });

  it('a currency with neither an anchor nor an in-range rate is absent from the result map', async () => {
    const { db } = makeFxHistoryDb({
      anchorRows: [fxRateRow({ currency: 'USD', date: '2025-12-31' })],
      dayRangeRows: [fxRateRow({ currency: 'USD', date: '2026-01-05' })],
    });
    const repo = fxRateRepository(db);

    const result = await repo.historyFor(
      [USD, currency('EUR')],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'nbp',
    );

    expect(result.has(USD)).toBe(true);
    expect(result.has(currency('EUR'))).toBe(false);
    expect(result.size).toBe(1);
  });

  it('returns an empty map without querying when currencies is empty', async () => {
    const { db, selectDistinctOn, select } = makeFxHistoryDb({});
    const repo = fxRateRepository(db);

    const result = await repo.historyFor(
      [],
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2026-01-10'),
      'day',
      'nbp',
    );

    expect(result.size).toBe(0);
    expect(selectDistinctOn).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe('fxRateRepository — coverageFor', () => {
  it('returns an empty map without querying when currencies is empty', async () => {
    const { fn: select } = makeWhereResolvedSelectChain<FxRateCoverageRow>([]);
    const db = { select } as unknown as Database;
    const repo = fxRateRepository(db);

    const result = await repo.coverageFor([], 'nbp');

    expect(result.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it('maps coveredFrom back to a Temporal.PlainDate, not the raw string', async () => {
    const row = fxRateCoverageRow({ currency: 'USD', coveredFrom: '2018-03-02' });
    const { fn: select } = makeWhereResolvedSelectChain([row]);
    const db = { select } as unknown as Database;
    const repo = fxRateRepository(db);

    const result = await repo.coverageFor([USD], 'nbp');

    const covered = result.get(USD);
    expect(covered).toBeInstanceOf(Temporal.PlainDate);
    expect(covered!.equals(Temporal.PlainDate.from('2018-03-02'))).toBe(true);
  });

  it('scopes the query to the given currencies and source', async () => {
    const { fn: select, where } = makeWhereResolvedSelectChain<FxRateCoverageRow>([]);
    const db = { select } as unknown as Database;
    const repo = fxRateRepository(db);

    await repo.coverageFor([USD, currency('EUR')], 'nbp');

    expect(where).toHaveBeenCalledWith(
      and(
        inArray(fxRateCoverage.currency, [USD, currency('EUR')]),
        eq(fxRateCoverage.source, 'nbp'),
      ),
    );
  });
});

describe('fxRateRepository — markCovered', () => {
  it('never touches the database when currencies is empty', async () => {
    const { insert } = makeInsertChain();
    const db = { insert } as unknown as Database;
    const repo = fxRateRepository(db);

    await repo.markCovered([], 'nbp', Temporal.PlainDate.from('2020-01-01'));

    expect(insert).not.toHaveBeenCalled();
  });

  it('sets coveredFrom to LEAST(existing, excluded) — a narrowing update is never constructed', async () => {
    const { insert, values, onConflictDoUpdate } = makeInsertChain();
    const db = { insert } as unknown as Database;
    const repo = fxRateRepository(db);

    await repo.markCovered([USD], 'nbp', Temporal.PlainDate.from('2020-01-01'));

    expect(insert).toHaveBeenCalledWith(fxRateCoverage);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ currency: USD, source: 'nbp', coveredFrom: '2020-01-01' }),
    ]);
    const call = onConflictDoUpdate.mock.calls[0]![0] as {
      target: unknown;
      set: { coveredFrom: unknown };
    };
    expect(call.target).toEqual([fxRateCoverage.currency, fxRateCoverage.source]);
    expect(call.set.coveredFrom).toEqual(expectedLeastCoveredFrom(fxRateCoverage.coveredFrom));
  });
});

/** `chainFor`'s shape: `select().from().innerJoin().where().orderBy()`, resolving directly. */
function makeJoinedOrderedSelectChain<Row>(rows: Row[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, innerJoin, where, orderBy };
}

/** `setChain`'s delete half: `delete().where()`, resolving directly. */
function makeDeleteChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where });
  return { del, where };
}

describe('symbolRepository — chainFor', () => {
  it('returns an empty map without querying for an empty id list', async () => {
    const select = vi.fn();
    const repo = symbolRepository({ select } as unknown as Database);

    const result = await repo.chainFor([]);

    expect(result.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it('joins in currency/kind from instruments and carries the admin-visible fields chainFor alone used to drop', async () => {
    const { select } = makeJoinedOrderedSelectChain([
      {
        instrumentId: INSTRUMENT_ID_1,
        provider: 'gpw',
        symbol: 'PLPKN0000018',
        priority: 0,
        fallbackCount: 2,
        lastFallbackAt: FETCHED_AT,
        verifiedAt: FETCHED_AT,
        currency: 'PLN',
        kind: 'equity',
      },
      {
        instrumentId: INSTRUMENT_ID_1,
        provider: 'yahoo',
        symbol: 'PKN.WA',
        priority: 1,
        fallbackCount: 0,
        lastFallbackAt: null,
        verifiedAt: FETCHED_AT,
        currency: 'PLN',
        kind: 'equity',
      },
    ]);
    const repo = symbolRepository({ select } as unknown as Database);

    const result = await repo.chainFor([INSTRUMENT_ID_1]);

    const chain = result.get(INSTRUMENT_ID_1);
    expect(chain?.map((entry) => entry.provider)).toEqual(['gpw', 'yahoo']);
    expect(chain?.map((entry) => entry.priority)).toEqual([0, 1]);
    expect(chain?.[0]?.fallbackCount).toBe(2);
    expect(chain?.[0]?.lastFallbackAt).not.toBeNull();
    expect(chain?.[1]?.lastFallbackAt).toBeNull();
    expect(chain?.[0]?.currency).toBe(currency('PLN'));
  });
});

describe('symbolRepository — setChain', () => {
  it('deletes providers no longer in the submitted list, then upserts the rest with fresh priorities', async () => {
    const { del, where: whereDelete } = makeDeleteChain();
    const { insert, values, onConflictDoUpdate } = makeInsertChain();
    const repo = symbolRepository({ delete: del, insert } as unknown as Database);

    await repo.setChain(INSTRUMENT_ID_1, [
      { provider: 'gpw', symbol: 'PLPKN0000018' },
      { provider: 'yahoo', symbol: 'PKN.WA' },
    ]);

    expect(whereDelete).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        instrumentId: INSTRUMENT_ID_1,
        provider: 'gpw',
        symbol: 'PLPKN0000018',
        priority: 0,
      }),
      expect.objectContaining({
        instrumentId: INSTRUMENT_ID_1,
        provider: 'yahoo',
        symbol: 'PKN.WA',
        priority: 1,
      }),
    ]);
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });

  it('deletes everything and skips the insert entirely when entries is empty', async () => {
    const { del, where: whereDelete } = makeDeleteChain();
    const insert = vi.fn();
    const repo = symbolRepository({ delete: del, insert } as unknown as Database);

    await repo.setChain(INSTRUMENT_ID_1, []);

    expect(whereDelete).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
