import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { InMemoryImports } from '../imports/in-memory-imports';
import { InMemoryLedger } from '../ledger/in-memory-ledger';
import { instrumentId, type Account } from '../ledger/types';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { type ParsedRow } from '../ports/statement-parser';
import { Temporal } from '../time';

import { makeAcceptImportRows } from './accept-import-rows';
import { type FieldIssue } from './result';

const USER = userId('11111111-1111-4111-8111-111111111111');
const INSTRUMENT = instrumentId('33333333-3333-4333-8333-333333333333');

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

/** Stages `rows` in one batch, against `account`, and returns the batch and staged rows. */
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

function makeUseCase(ledger: InMemoryLedger, imports: InMemoryImports) {
  return makeAcceptImportRows({
    imports: imports.forUser(USER),
    ledger: ledger.forUser(USER),
  });
}

describe('makeAcceptImportRows', () => {
  it('returns a failure for a batchId that is not a UUID', async () => {
    const { ledger, imports } = await setup();
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows('not-a-uuid');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'batchId')).toBeDefined();
  });

  it('returns a failure for an unknown batch id', async () => {
    const { ledger, imports } = await setup();
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows('99999999-9999-4999-8999-999999999999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'batchId')).toBeDefined();
  });

  it('succeeds with no rows touched when the batch has nothing acceptable', async () => {
    const { ledger, imports, account } = await setup();
    const { batch } = await seedBatch(imports, account, [cashRow({ externalId: 'row-1' })]);
    // Reject the only row up front so nothing stays `pending`.
    await imports
      .forUser(USER)
      .recordRowOutcome((await imports.forUser(USER).rowsForBatch(batch.id))[0]!.id, {
        status: 'rejected',
        reason: 'skipped',
      });
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('bulk-creates a transaction per fresh row in one batch, each accepted', async () => {
    const { ledger, imports, account } = await setup();
    const { batch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
      cashRow({ externalId: 'row-2', grossAmount: Money.of('2000', currency('PLN')) }),
      cashRow({ externalId: 'row-3', grossAmount: Money.of('3000', currency('PLN')) }),
    ]);
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value.every((row) => row.status === 'accepted')).toBe(true);

    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions).toHaveLength(3);
    expect(new Set(transactions.map((transaction) => transaction.externalId))).toEqual(
      new Set(['row-1', 'row-2', 'row-3']),
    );
    expect(transactions.every((transaction) => transaction.source === 'import')).toBe(true);
    expect(transactions.every((transaction) => transaction.importBatchId === batch.id)).toBe(true);
  });

  it('refreshes an existing unedited transaction in place rather than creating a second one', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const acceptImportRows = makeUseCase(ledger, imports);
    const first = await acceptImportRows(firstBatch.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalTransactionId = first.value[0]!.transactionId!;

    const { batch: secondBatch } = await seedBatch(imports, account, [
      cashRow({
        externalId: 'row-1',
        grossAmount: Money.of('1250', currency('PLN')),
        tradeDate: Temporal.PlainDate.from('2024-01-11'),
      }),
    ]);

    const second = await acceptImportRows(secondBatch.id);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toHaveLength(1);
    expect(second.value[0]!.status).toBe('accepted');
    expect(second.value[0]!.transactionId).toBe(originalTransactionId);

    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.grossAmount?.equals(Money.of('1250', currency('PLN')))).toBe(true);
  });

  it('settles as duplicate, without writing, when the match is soft-deleted', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const acceptImportRows = makeUseCase(ledger, imports);
    const first = await acceptImportRows(firstBatch.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalTransactionId = first.value[0]!.transactionId!;
    await ledger.forUser(USER).softDeleteTransaction(originalTransactionId);

    const { batch: secondBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1250', currency('PLN')) }),
    ]);

    const second = await acceptImportRows(secondBatch.id);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toHaveLength(1);
    expect(second.value[0]!.status).toBe('duplicate');
    expect(second.value[0]!.transactionId).toBe(originalTransactionId);
    expect(second.value[0]!.rejectionReason).toBeTruthy();
    expect(ledger.isDeleted(originalTransactionId)).toBe(true);
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(0);
  });

  it('leaves a hand-edited transaction untouched and reports the row as a duplicate', async () => {
    const { ledger, imports, account } = await setup();
    const { batch: firstBatch } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    ]);
    const acceptImportRows = makeUseCase(ledger, imports);
    const first = await acceptImportRows(firstBatch.id);
    expect(first.ok).toBe(true);
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
      cashRow({ externalId: 'row-1', grossAmount: Money.of('999', currency('PLN')) }),
    ]);

    const second = await acceptImportRows(secondBatch.id);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value[0]!.status).toBe('duplicate');
    expect(second.value[0]!.transactionId).toBe(transactionId);

    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.grossAmount?.equals(Money.of('1234.56', currency('PLN')))).toBe(true);
  });

  it('leaves an invalid row pending without aborting the rest of the batch', async () => {
    const { ledger, imports, account } = await setup();
    const { batch, rows } = await seedBatch(imports, account, [
      // Currency differs from the account with no fxRate — refused by validation.
      cashRow({
        externalId: 'row-1',
        currency: currency('USD'),
        grossAmount: Money.of('1000', currency('USD')),
        fxRate: null,
        fxRateSource: null,
      }),
      cashRow({ externalId: 'row-2', grossAmount: Money.of('2000', currency('PLN')) }),
    ]);
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.status).toBe('accepted');

    const stillPending = await imports.forUser(USER).getRow(rows[0]!.id);
    expect(stillPending!.status).toBe('pending');
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(1);
  });

  it('skips a row whose instrument candidate has not yet been resolved, leaving it pending', async () => {
    const { ledger, imports, account } = await setup();
    const { batch, rows } = await seedBatch(imports, account, [
      cashRow({
        externalId: 'row-1',
        instrument: { symbol: 'AAPL', exchange: null, name: 'Apple Inc.' },
      }),
      cashRow({ externalId: 'row-2' }),
    ]);
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.transactionId).not.toBeNull();

    const stillPending = await imports.forUser(USER).getRow(rows[0]!.id);
    expect(stillPending!.status).toBe('pending');
  });

  it('resolves an instrument-bearing row once resolveInstruments has run', async () => {
    const { ledger, imports, account } = await setup();
    const { batch, rows } = await seedBatch(imports, account, [
      cashRow({
        externalId: 'row-1',
        instrument: { symbol: 'AAPL', exchange: null, name: 'Apple Inc.' },
      }),
    ]);
    await imports
      .forUser(USER)
      .resolveInstruments(batch.id, [{ symbol: 'AAPL', exchange: null, instrumentId: INSTRUMENT }]);
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const transaction = await ledger.forUser(USER).getTransaction(result.value[0]!.transactionId!);
    expect(transaction!.instrumentId).toBe(INSTRUMENT);
    void rows;
  });

  it('skips a row that is not pending (already reviewed), leaving it untouched', async () => {
    const { ledger, imports, account } = await setup();
    const { batch, rows } = await seedBatch(imports, account, [
      cashRow({ externalId: 'row-1' }),
      cashRow({ externalId: 'row-2' }),
    ]);
    await imports.forUser(USER).recordRowOutcome(rows[0]!.id, {
      status: 'rejected',
      reason: 'skipped during review',
    });
    const acceptImportRows = makeUseCase(ledger, imports);

    const result = await acceptImportRows(batch.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.transactionId).not.toBeNull();

    const rejectedRow = await imports.forUser(USER).getRow(rows[0]!.id);
    expect(rejectedRow!.status).toBe('rejected');
  });
});
