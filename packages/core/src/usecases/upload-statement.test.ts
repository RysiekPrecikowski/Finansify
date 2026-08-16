import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryLedger } from '../ledger/in-memory-ledger';
import { InMemoryImports } from '../imports/in-memory-imports';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { type Clock } from '../ports/clock';
import { type FileStore, type StoredFile } from '../ports/file-store';
import {
  type BrokerId,
  type Confidence,
  type ParsedRow,
  type ParsedStatement,
  type RawFile,
  type StatementParser,
} from '../ports/statement-parser';
import { Temporal } from '../time';
import { makeUploadStatement } from './upload-statement';
import { type FieldIssue } from './result';

const FIXED_NOW_MS = 1_700_000_000_000;
const clock: Clock = { now: () => Temporal.Instant.fromEpochMilliseconds(FIXED_NOW_MS) };

const FILE: RawFile = {
  filename: 'statement.csv',
  bytes: Uint8Array.from(
    'external_id,type\nrow-1,buy\n'.split('').map((char) => char.charCodeAt(0)),
  ),
};

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

function makeFileStore() {
  return {
    put: vi.fn((key: string, _bytes: Uint8Array): Promise<StoredFile> =>
      Promise.resolve({ key, url: `https://blob.example/${key}` }),
    ),
  } satisfies FileStore;
}

function makeParser(
  broker: BrokerId,
  confidence: Confidence,
  statement: { rows?: readonly ParsedRow[]; warnings?: readonly string[] } = {},
) {
  return {
    broker,
    sniff: vi.fn(() => Promise.resolve(confidence)),
    parse: vi.fn((): Promise<ParsedStatement> =>
      Promise.resolve({
        broker,
        rows: statement.rows ?? [],
        warnings: statement.warnings ?? [],
      }),
    ),
  } satisfies StatementParser;
}

function parsedRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    externalId: 'row-1',
    instrument: { symbol: 'AAPL', exchange: null, name: null },
    type: 'buy',
    tradeDate: Temporal.PlainDate.from('2024-01-10'),
    settleDate: null,
    quantity: new Decimal('10'),
    price: Money.of('100', currency('PLN')),
    grossAmount: null,
    fee: Money.of('0', currency('PLN')),
    tax: Money.of('0', currency('PLN')),
    currency: currency('PLN'),
    fxRate: null,
    fxRateSource: null,
    note: null,
    warnings: [],
    ...overrides,
  };
}

/**
 * One caller's account and a second user's account, the same shape
 * `record-transaction.test.ts` uses to exercise the ownership check —
 * ownership here is enforced the identical way, by looking the account up
 * via the caller's own `listAccounts()`.
 */
async function setup() {
  const ledger = new InMemoryLedger();
  const imports = new InMemoryImports();
  const userA = userId('11111111-1111-4111-8111-111111111111');
  const userB = userId('22222222-2222-4222-8222-222222222222');

  const account = await ledger.forUser(userA).createAccount({
    name: 'A XTB brokerage',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: currency('PLN'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });
  const foreignAccount = await ledger.forUser(userB).createAccount({
    name: 'B XTB brokerage',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: currency('PLN'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });

  return { ledger, imports, userA, userB, account, foreignAccount };
}

describe('makeUploadStatement', () => {
  it('rejects an accountId that is not a UUID, without touching the file store or any parser', async () => {
    const { ledger, imports, userA } = await setup();
    const fileStore = makeFileStore();
    const parser = makeParser('xtb', 'certain');
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: 'not-a-uuid', file: FILE });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'accountId')).toBeDefined();
    expect(fileStore.put).not.toHaveBeenCalled();
    expect(parser.sniff).not.toHaveBeenCalled();
    expect(parser.parse).not.toHaveBeenCalled();
    expect(imports.allBatches()).toHaveLength(0);
  });

  it('rejects a syntactically valid accountId that belongs to another user, without touching the file store or any parser', async () => {
    const { ledger, imports, userA, foreignAccount } = await setup();
    const fileStore = makeFileStore();
    const parser = makeParser('xtb', 'certain');
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: foreignAccount.id, file: FILE });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'accountId')).toBeDefined();
    expect(fileStore.put).not.toHaveBeenCalled();
    expect(parser.sniff).not.toHaveBeenCalled();
    expect(parser.parse).not.toHaveBeenCalled();
    expect(imports.allBatches()).toHaveLength(0);
  });

  it('picks the parser that sniffs certain over others that sniff possible or none', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const none = makeParser('none-broker', 'none');
    const possible = makeParser('possible-broker', 'possible');
    const certain = makeParser('certain-broker', 'certain');
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [none, possible, certain],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.broker).toBe('certain-broker');
    expect(certain.parse).toHaveBeenCalledTimes(1);
    expect(possible.parse).not.toHaveBeenCalled();
    expect(none.parse).not.toHaveBeenCalled();
  });

  it('falls back to a parser that sniffs possible when no parser sniffs certain', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const none = makeParser('none-broker', 'none');
    const possible = makeParser('possible-broker', 'possible');
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [none, possible],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.broker).toBe('possible-broker');
    expect(possible.parse).toHaveBeenCalledTimes(1);
    expect(none.parse).not.toHaveBeenCalled();
  });

  it('rejects when every registered parser sniffs none, without touching the file store', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const parserA = makeParser('a-broker', 'none');
    const parserB = makeParser('b-broker', 'none');
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [parserA, parserB],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'file')).toBeDefined();
    expect(fileStore.put).not.toHaveBeenCalled();
    expect(imports.allBatches()).toHaveLength(0);
  });

  it('rejects when there are no registered parsers at all, without touching the file store', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'file')).toBeDefined();
    expect(fileStore.put).not.toHaveBeenCalled();
    expect(imports.allBatches()).toHaveLength(0);
  });

  it('stores the file under an account-scoped key, stages every parsed row, and returns the batch reflecting markBatchParsed rather than the pending batch createBatch returned', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const rows = [
      parsedRow({ externalId: 'row-1' }),
      parsedRow({ externalId: 'row-2', instrument: null, price: null }),
    ];
    const parser = makeParser('xtb', 'certain', { rows, warnings: ['a statement-level heads-up'] });
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedBlobKey = `imports/${account.id}/${FIXED_NOW_MS}-${FILE.filename}`;
    expect(fileStore.put).toHaveBeenCalledTimes(1);
    expect(fileStore.put).toHaveBeenCalledWith(expectedBlobKey, FILE.bytes);

    expect(result.value.accountId).toBe(account.id);
    expect(result.value.broker).toBe('xtb');
    expect(result.value.blobKey).toBe(expectedBlobKey);
    // Not 'pending' — createBatch's own return is a stepping stone, never the final value.
    expect(result.value.status).toBe('parsed');
    expect(result.value.totalRows).toBe(2);
    expect(result.value.warnings).toEqual(['a statement-level heads-up']);

    const staged = imports.rowsFor(result.value.id);
    expect(staged).toHaveLength(2);
    expect(staged.map((row) => row.rowIndex)).toEqual([0, 1]);
    expect(staged.map((row) => row.parsed)).toEqual(rows);
  });

  it('does not propagate a thrown parse() error — resolves success with the batch marked failed and the reason taken from the error message', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const parser: StatementParser = {
      broker: 'xtb',
      sniff: vi.fn(() => Promise.resolve('certain' as const)),
      parse: vi.fn(() => Promise.reject(new Error('malformed CSV on line 4'))),
    };
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failed');
    expect(result.value.failureReason).toBe('malformed CSV on line 4');
    expect(imports.rowsFor(result.value.id)).toHaveLength(0);
  });

  it('derives the failure reason from String(error) when parse() rejects with a non-Error value', async () => {
    const { ledger, imports, userA, account } = await setup();
    const fileStore = makeFileStore();
    const parser: StatementParser = {
      broker: 'xtb',
      sniff: vi.fn(() => Promise.resolve('certain' as const)),
      // Exercises the `String(error)` fallback branch on purpose — a real
      // rejection is not always an `Error`.
      parse: vi.fn(() => Promise.reject('unexpected token')),
    };
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore,
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failed');
    expect(result.value.failureReason).toBe('unexpected token');
  });

  /**
   * The account comes from a dropdown, the currency comes from the file, and
   * a multi-currency XTB user has one account per currency with identical
   * names in that dropdown. Picking the wrong one stages a whole statement
   * against an account that does not hold that currency, and every amount
   * looks right in isolation — the mismatch is only visible by comparing the
   * two, which nothing did before this warning.
   */
  it('warns when the statement reports a currency the chosen account does not hold', async () => {
    const { ledger, imports, userA, account } = await setup();
    const rows = [
      parsedRow({ externalId: 'row-1', currency: currency('USD') }),
      parsedRow({ externalId: 'row-2', currency: currency('USD') }),
    ];
    const parser = makeParser('xtb', 'certain', { rows });
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore: makeFileStore(),
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Staged, not refused — the rows are correct as parsed, and the batch is
    // reviewed before any of it becomes a `Transaction`.
    expect(result.value.status).toBe('parsed');
    expect(result.value.totalRows).toBe(2);
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toContain('USD');
    expect(result.value.warnings[0]).toContain('PLN');
    expect(result.value.warnings[0]).toContain(account.name);
  });

  it('reports each mismatched currency once, alongside the parser own warnings', async () => {
    const { ledger, imports, userA, account } = await setup();
    const rows = [
      parsedRow({ externalId: 'row-1', currency: currency('USD') }),
      parsedRow({ externalId: 'row-2', currency: currency('USD') }),
      parsedRow({ externalId: 'row-3', currency: currency('EUR') }),
      parsedRow({ externalId: 'row-4', currency: currency('PLN') }),
    ];
    const parser = makeParser('xtb', 'certain', { rows, warnings: ['from the parser'] });
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore: makeFileStore(),
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toHaveLength(2);
    expect(result.value.warnings[0]).toBe('from the parser');
    expect(result.value.warnings[1]).toContain('USD, EUR');
  });

  it('adds no warning when every row matches the account currency', async () => {
    const { ledger, imports, userA, account } = await setup();
    const parser = makeParser('xtb', 'certain', { rows: [parsedRow()] });
    const uploadStatement = makeUploadStatement({
      ledger: ledger.forUser(userA),
      imports: imports.forUser(userA),
      fileStore: makeFileStore(),
      parsers: [parser],
      clock,
    });

    const result = await uploadStatement({ accountId: account.id, file: FILE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toEqual([]);
  });
});
