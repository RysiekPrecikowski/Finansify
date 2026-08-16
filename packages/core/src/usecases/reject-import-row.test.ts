import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { InMemoryImports } from '../imports/in-memory-imports';
import { accountId, transactionId } from '../ledger/types';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { type ParsedRow } from '../ports/statement-parser';
import { Temporal } from '../time';

import { makeRejectImportRow } from './reject-import-row';
import { type FieldIssue } from './result';

const USER = userId('11111111-1111-4111-8111-111111111111');
const ACCOUNT = accountId('22222222-2222-4222-8222-222222222222');

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

/** A cash row — `deposit` needs no instrument resolution. */
function cashRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    externalId: 'row-1',
    instrument: null,
    type: 'deposit',
    tradeDate: Temporal.PlainDate.from('2024-01-10'),
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
    ...overrides,
  };
}

/** Stages one row in its own batch, against `ACCOUNT`. */
async function seedRow(imports: InMemoryImports, overrides: Partial<ParsedRow> = {}) {
  const scoped = imports.forUser(USER);
  const batch = await scoped.createBatch({
    accountId: ACCOUNT,
    broker: 'xtb',
    blobKey: `imports/${ACCOUNT}/1700000000000-statement.csv`,
  });
  const [row] = await scoped.createRows(batch.id, [cashRow(overrides)]);
  return { batch, row: row! };
}

function makeUseCase(imports: InMemoryImports) {
  return makeRejectImportRow({ imports: imports.forUser(USER) });
}

// `makeRejectImportRow`'s parameter type is `{ imports: ScopedImportRepository }`
// only — every call to it below (via `makeUseCase`) constructs deps with
// nothing but `imports`. TypeScript's excess-property check on that object
// literal is the proof, by construction, that no `ScopedLedgerRepository` is
// part of this use case's dependencies: rejecting a row never touches the
// ledger. That guarantee is enforced at compile time (`pnpm check`'s
// typecheck step), not something a runtime assertion could add to.
describe('makeRejectImportRow', () => {
  it('returns a failure for a rowId that is not a UUID', async () => {
    const imports = new InMemoryImports();
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow('not-a-uuid', 'not needed');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
  });

  it('returns a failure for an unknown row id', async () => {
    const imports = new InMemoryImports();
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow('99999999-9999-4999-8999-999999999999', 'not needed');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
  });

  it('refuses a row that is not pending', async () => {
    const imports = new InMemoryImports();
    const { row } = await seedRow(imports);
    // Settle the row via the port directly, bypassing the use case, so it
    // reaches `rejectImportRow` already `accepted`.
    await imports.forUser(USER).recordRowOutcome(row.id, {
      status: 'accepted',
      transactionId: transactionId('44444444-4444-4444-8444-444444444444'),
    });
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow(row.id, 'changed my mind');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
  });

  it('returns a failure for an empty reason', async () => {
    const imports = new InMemoryImports();
    const { row } = await seedRow(imports);
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow(row.id, '');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'reason')).toBeDefined();
  });

  it('returns a failure for a whitespace-only reason', async () => {
    const imports = new InMemoryImports();
    const { row } = await seedRow(imports);
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow(row.id, '   \t\n  ');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'reason')).toBeDefined();
  });

  it('settles a pending row to rejected, with the trimmed reason and no transaction', async () => {
    const imports = new InMemoryImports();
    const { row } = await seedRow(imports);
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow(row.id, '  duplicate line item  ');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
    expect(result.value.rejectionReason).toBe('duplicate line item');
    expect(result.value.transactionId).toBeNull();

    const refetched = await imports.forUser(USER).getRow(row.id);
    expect(refetched).not.toBeNull();
    expect(refetched!.status).toBe('rejected');
    expect(refetched!.rejectionReason).toBe('duplicate line item');
    expect(refetched!.transactionId).toBeNull();
  });

  it('calls recordRowOutcome with exactly {status: "rejected", reason: <trimmed>} — no transactionId field', async () => {
    const imports = new InMemoryImports();
    const { row } = await seedRow(imports);
    const scoped = imports.forUser(USER);
    const calls: unknown[] = [];
    const originalRecordRowOutcome = scoped.recordRowOutcome.bind(scoped);
    scoped.recordRowOutcome = (id, outcome) => {
      calls.push(outcome);
      return originalRecordRowOutcome(id, outcome);
    };
    const rejectImportRow = makeRejectImportRow({ imports: scoped });

    await rejectImportRow(row.id, '  needs review  ');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ status: 'rejected', reason: 'needs review' });
    expect(Object.keys(calls[0] as Record<string, unknown>).sort()).toEqual(['reason', 'status']);
  });

  it('a rejected row still counts against the batch even though it stays unaccepted', async () => {
    const imports = new InMemoryImports();
    const { batch, row } = await seedRow(imports);
    await imports.forUser(USER).markBatchParsed(batch.id, { totalRows: 1, warnings: [] });
    const rejectImportRow = makeUseCase(imports);

    const result = await rejectImportRow(row.id, 'skip this one');

    expect(result.ok).toBe(true);
    const refetchedBatch = await imports.forUser(USER).getBatch(batch.id);
    expect(refetchedBatch!.totalRows).toBe(1);
  });
});
