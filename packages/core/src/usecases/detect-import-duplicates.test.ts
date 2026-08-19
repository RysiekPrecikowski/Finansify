import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { InMemoryImports } from '../imports/in-memory-imports';
import { InMemoryLedger } from '../ledger/in-memory-ledger';
import { type Account } from '../ledger/types';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { type ParsedRow } from '../ports/statement-parser';
import { Temporal } from '../time';

import { makeAcceptImportRows } from './accept-import-rows';
import { makeDetectImportDuplicates } from './detect-import-duplicates';
import { type FieldIssue } from './result';

const USER = userId('11111111-1111-4111-8111-111111111111');

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

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

async function setup() {
  const ledger = new InMemoryLedger();
  const imports = new InMemoryImports();
  const account = await ledger.forUser(USER).createAccount({
    name: 'A XTB brokerage',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: currency('PLN'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });
  return { ledger, imports, account };
}

async function seedBatch(imports: InMemoryImports, account: Account, rows: readonly ParsedRow[]) {
  const scoped = imports.forUser(USER);
  const batch = await scoped.createBatch({
    accountId: account.id,
    broker: 'xtb',
    blobKey: `imports/${account.id}/1700000000000-statement.csv`,
  });
  const created = await scoped.createRows(batch.id, rows);
  return { batch, rows: created };
}

function makeUseCases(ledger: InMemoryLedger, imports: InMemoryImports) {
  const deps = { imports: imports.forUser(USER), ledger: ledger.forUser(USER) };
  return {
    detectImportDuplicates: makeDetectImportDuplicates(deps),
    acceptImportRows: makeAcceptImportRows(deps),
  };
}

describe('makeDetectImportDuplicates', () => {
  it('returns a failure for a batchId that is not a UUID', async () => {
    const { ledger, imports } = await setup();
    const { detectImportDuplicates } = makeUseCases(ledger, imports);

    const result = await detectImportDuplicates('not-a-uuid');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'batchId')).toBeDefined();
  });

  it('classifies every fresh row as new, without writing anything', async () => {
    const { ledger, imports, account } = await setup();
    const { batch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1' }),
      cashRow({ externalId: 'row-2' }),
    ]);
    const { detectImportDuplicates } = makeUseCases(ledger, imports);

    const result = await detectImportDuplicates(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.every((preview) => preview.classification.kind === 'new')).toBe(true);
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(0);
    const rows = await imports.forUser(USER).rowsForBatch(batch.id);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
  });

  it('classifies an identical reimport as unchanged', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const { detectImportDuplicates, acceptImportRows } = makeUseCases(ledger, imports);
    await acceptImportRows(firstBatch.id);

    const { batch: secondBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);

    const result = await detectImportDuplicates(secondBatch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.classification.kind).toBe('unchanged');
  });

  it('classifies a reimport with different data as changed', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const { detectImportDuplicates, acceptImportRows } = makeUseCases(ledger, imports);
    await acceptImportRows(firstBatch.id);

    const { batch: secondBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1250', currency('PLN')) }),
    ]);

    const result = await detectImportDuplicates(secondBatch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.classification.kind).toBe('changed');
    // Preview only — the actual transaction is untouched.
    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions[0]!.grossAmount?.equals(Money.of('1000', currency('PLN')))).toBe(true);
  });

  it('classifies a hand-edited match as conflict', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const { detectImportDuplicates, acceptImportRows } = makeUseCases(ledger, imports);
    const first = await acceptImportRows(firstBatch.id);
    if (!first.ok) return;
    const transactionId = first.value[0]!.transactionId!;
    await ledger.forUser(USER).updateTransaction(transactionId, {
      accountId: account.id,
      instrumentId: null,
      type: 'deposit',
      tradeDate: '2024-01-10',
      settleDate: null,
      quantity: '0',
      price: null,
      grossAmount: '1234.56',
      fee: '0',
      tax: '0',
      currency: 'PLN',
      fxRate: null,
      fxRateSource: null,
      note: 'corrected by hand',
    });

    const { batch: secondBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);

    const result = await detectImportDuplicates(secondBatch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.classification.kind).toBe('conflict');
  });

  it('classifies a match against a soft-deleted transaction as deleted', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const { detectImportDuplicates, acceptImportRows } = makeUseCases(ledger, imports);
    const first = await acceptImportRows(firstBatch.id);
    if (!first.ok) return;
    await ledger.forUser(USER).softDeleteTransaction(first.value[0]!.transactionId!);

    const { batch: secondBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);

    const result = await detectImportDuplicates(secondBatch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.classification.kind).toBe('deleted');
  });
});
