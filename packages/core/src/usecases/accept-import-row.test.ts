import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { InMemoryImports } from '../imports/in-memory-imports';
import { InMemoryLedger } from '../ledger/in-memory-ledger';
import { instrumentId, type Account } from '../ledger/types';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { type ParsedRow } from '../ports/statement-parser';
import { Temporal } from '../time';

import { makeAcceptImportRow } from './accept-import-row';
import { type FieldIssue } from './result';

const USER = userId('11111111-1111-4111-8111-111111111111');
const INSTRUMENT = instrumentId('33333333-3333-4333-8333-333333333333');

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

function parsedRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    externalId: 'row-1',
    instrument: { symbol: 'AAPL', exchange: null, name: 'Apple Inc.' },
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

/** A cash row needs no instrument resolution — `deposit` sails through with `instrumentId: null`. */
function cashRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return parsedRow({
    instrument: null,
    type: 'deposit',
    quantity: new Decimal('0'),
    price: null,
    grossAmount: Money.of('1000', currency('PLN')),
    ...overrides,
  });
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

/** Stages one row in its own batch, against `account`. */
async function seedRow(
  imports: InMemoryImports,
  account: Account,
  overrides: Partial<ParsedRow> = {},
) {
  const scoped = imports.forUser(USER);
  const batch = await scoped.createBatch({
    accountId: account.id,
    broker: 'xtb',
    blobKey: `imports/${account.id}/1700000000000-statement.csv`,
  });
  const [row] = await scoped.createRows(batch.id, [parsedRow(overrides)]);
  return { batch, row: row! };
}

function makeUseCase(ledger: InMemoryLedger, imports: InMemoryImports) {
  return makeAcceptImportRow({
    imports: imports.forUser(USER),
    ledger: ledger.forUser(USER),
  });
}

describe('makeAcceptImportRow', () => {
  it('returns a failure for a rowId that is not a UUID', async () => {
    const { ledger, imports } = await setup();
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow('not-a-uuid');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
  });

  it('returns a failure for an unknown row id', async () => {
    const { ledger, imports } = await setup();
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow('99999999-9999-4999-8999-999999999999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
  });

  it('refuses a row that has already been reviewed, and writes nothing further', async () => {
    const { ledger, imports, account } = await setup();
    const { row } = await seedRow(imports, account, cashRow());
    const acceptImportRow = makeUseCase(ledger, imports);
    const first = await acceptImportRow(row.id);
    expect(first.ok).toBe(true);

    const second = await acceptImportRow(row.id);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(issueAt(second.issues, 'rowId')).toBeDefined();
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(1);
  });

  it('refuses a row whose instrument candidate has not yet been resolved', async () => {
    const { ledger, imports, account } = await setup();
    // `parsedRow()`'s default has an instrument candidate; `seedRow` never
    // calls `resolveInstruments`, so `resolvedInstrumentId` stays null.
    const { row } = await seedRow(imports, account);
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(0);
  });

  it('accepts a cash-type row with no instrument candidate, needing no resolution', async () => {
    const { ledger, imports, account } = await setup();
    const { row } = await seedRow(imports, account, cashRow());
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('accepted');
    expect(result.value.transactionId).not.toBeNull();
  });

  it('creates a transaction with source import when no existing transaction matches (accountId, externalId)', async () => {
    const { ledger, imports, account } = await setup();
    const { batch, row } = await seedRow(imports, account, cashRow({ externalId: 'row-1' }));
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transaction = await ledger.forUser(USER).getTransaction(result.value.transactionId!);
    expect(transaction).not.toBeNull();
    expect(transaction!.source).toBe('import');
    expect(transaction!.externalId).toBe('row-1');
    expect(transaction!.importBatchId).toBe(batch.id);
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(1);
  });

  it('refuses a row whose currency differs from its account and carries no fxRate, writing nothing', async () => {
    const { ledger, imports, account } = await setup();
    const { row } = await seedRow(
      imports,
      account,
      cashRow({
        currency: currency('USD'),
        grossAmount: Money.of('1000', currency('USD')),
        fxRate: null,
        fxRateSource: null,
      }),
    );
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'fxRate')).toBeDefined();
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(0);
  });

  it('refreshes an existing unedited transaction in place rather than creating a second one', async () => {
    const { ledger, imports, account } = await setup();
    const { row: firstRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const acceptImportRow = makeUseCase(ledger, imports);
    const first = await acceptImportRow(firstRow.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalTransactionId = first.value.transactionId!;

    // Same account, same externalId — a re-upload of the same statement with
    // a restated amount, not a second, unrelated cash line.
    const { row: secondRow } = await seedRow(
      imports,
      account,
      cashRow({
        externalId: 'row-1',
        grossAmount: Money.of('1250', currency('PLN')),
        tradeDate: Temporal.PlainDate.from('2024-01-11'),
      }),
    );

    const second = await acceptImportRow(secondRow.id);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe('accepted');
    expect(second.value.transactionId).toBe(originalTransactionId);

    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.id).toBe(originalTransactionId);
    expect(transactions[0]!.grossAmount?.equals(Money.of('1250', currency('PLN')))).toBe(true);
    expect(transactions[0]!.tradeDate.toString()).toBe('2024-01-11');
    expect(transactions[0]!.source).toBe('import');
    expect(transactions[0]!.externalId).toBe('row-1');
  });

  it('leaves a hand-edited transaction completely untouched and reports the row as a duplicate', async () => {
    const { ledger, imports, account } = await setup();
    const { row: firstRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const acceptImportRow = makeUseCase(ledger, imports);
    const first = await acceptImportRow(firstRow.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const transactionId = first.value.transactionId!;

    // A hand correction via the ordinary transaction-edit path — the same
    // method a manual edit goes through — is what sets `editedAfterImport`.
    const handEdited = await ledger.forUser(USER).updateTransaction(transactionId, {
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
    expect(handEdited.editedAfterImport).toBe(true);

    const { row: secondRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('999', currency('PLN')) }),
    );

    const second = await acceptImportRow(secondRow.id);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe('duplicate');
    expect(second.value.transactionId).toBe(transactionId);
    expect(second.value.rejectionReason).toBeTruthy();

    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.grossAmount?.equals(Money.of('1234.56', currency('PLN')))).toBe(true);
    expect(transactions[0]!.note).toBe('corrected by hand');
  });

  it('settles as duplicate, without throwing, when (accountId, externalId) already names a soft-deleted transaction — and leaves it deleted', async () => {
    const { ledger, imports, account } = await setup();
    const { row: firstRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const acceptImportRow = makeUseCase(ledger, imports);
    const first = await acceptImportRow(firstRow.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalTransactionId = first.value.transactionId!;

    // A manual delete of the resulting transaction, exactly the scenario the
    // bug this regression test guards against was hit by: the transaction
    // still occupies (account_id, external_id) even though it is gone from
    // the user's view.
    await ledger.forUser(USER).softDeleteTransaction(originalTransactionId);

    const { row: secondRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1250', currency('PLN')) }),
    );

    const second = await acceptImportRow(secondRow.id);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe('duplicate');
    expect(second.value.transactionId).toBe(originalTransactionId);
    expect(second.value.rejectionReason).toBeTruthy();

    // Not resurrected, not refreshed, not re-created.
    expect(ledger.isDeleted(originalTransactionId)).toBe(true);
    expect(ledger.rawRowCount()).toBe(1);
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(0);
  });

  it('resolves an instrument-bearing row once resolveInstruments has run', async () => {
    const { ledger, imports, account } = await setup();
    const { batch, row } = await seedRow(imports, account, { externalId: 'row-1' });
    await imports
      .forUser(USER)
      .resolveInstruments(batch.id, [{ symbol: 'AAPL', exchange: null, instrumentId: INSTRUMENT }]);
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transaction = await ledger.forUser(USER).getTransaction(result.value.transactionId!);
    expect(transaction!.instrumentId).toBe(INSTRUMENT);
  });

  /**
   * Regression test for a bug caught in this ticket: the refresh branch
   * originally reused `updateTransaction`, the same port method a hand edit
   * goes through — and `packages/db/src/ledger-repository.ts` flips
   * `editedAfterImport` on *any* update to a `source: 'import'` row, unable to
   * tell a re-import refresh from a real hand correction. That made a second
   * re-import of the same statement misreport as a conflict against a row
   * nobody had touched. Fixed by giving the refresh its own port method,
   * `refreshImportedTransaction`, which never writes that column at all — this
   * asserts three repeated re-imports of the same `externalId` all land as
   * plain `accepted` refreshes, with `editedAfterImport` staying `false`
   * throughout.
   */
  it('refreshes the same externalId across repeated re-imports without ever flagging it as a hand-edit conflict', async () => {
    const { ledger, imports, account } = await setup();
    const acceptImportRow = makeUseCase(ledger, imports);

    const { row: firstRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const first = await acceptImportRow(firstRow.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe('accepted');
    const transactionId = first.value.transactionId!;
    expect((await ledger.forUser(USER).getTransaction(transactionId))!.editedAfterImport).toBe(
      false,
    );

    const { row: secondRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const second = await acceptImportRow(secondRow.id);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe('accepted');
    expect(second.value.transactionId).toBe(transactionId);
    expect((await ledger.forUser(USER).getTransaction(transactionId))!.editedAfterImport).toBe(
      false,
    );

    const { row: thirdRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const third = await acceptImportRow(thirdRow.id);

    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.status).toBe('accepted');
    expect(third.value.transactionId).toBe(transactionId);
    expect((await ledger.forUser(USER).getTransaction(transactionId))!.editedAfterImport).toBe(
      false,
    );
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(1);
  });
});

describe('makeAcceptImportRow — overrides', () => {
  it('applies an override field onto a cash row, replacing the parsed value', async () => {
    const { ledger, imports, account } = await setup();
    const { row } = await seedRow(imports, account, cashRow({ note: 'original note' }));
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id, { note: 'edited note' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transaction = await ledger.forUser(USER).getTransaction(result.value.transactionId!);
    expect(transaction!.note).toBe('edited note');
  });

  it('never lets an override hijack accountId away from the batch’s own account', async () => {
    const { ledger, imports, account } = await setup();
    const otherAccount = await ledger.forUser(USER).createAccount({
      name: 'A different brokerage',
      broker: 'Revolut',
      wrapper: 'brokerage',
      currency: currency('PLN'),
      openedAt: Temporal.PlainDate.from('2024-01-01'),
    });
    const { row } = await seedRow(imports, account, cashRow());
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id, { accountId: otherAccount.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transaction = await ledger.forUser(USER).getTransaction(result.value.transactionId!);
    expect(transaction!.accountId).toBe(account.id);
    expect(transaction!.accountId).not.toBe(otherAccount.id);
  });

  it('accepts an unresolved instrument-bearing row when overrides.instrumentId supplies one directly', async () => {
    const { ledger, imports, account } = await setup();
    // Default `parsedRow()` carries an instrument candidate; `seedRow` never
    // calls `resolveInstruments`, so `resolvedInstrumentId` stays null — the
    // override has to be what unblocks the "resolve first" check.
    const { row } = await seedRow(imports, account);
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id, { instrumentId: INSTRUMENT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transaction = await ledger.forUser(USER).getTransaction(result.value.transactionId!);
    expect(transaction!.instrumentId).toBe(INSTRUMENT);
  });

  it('still refuses an instrument-bearing row when overrides explicitly nulls out instrumentId', async () => {
    const { ledger, imports, account } = await setup();
    const { row } = await seedRow(imports, account);
    const acceptImportRow = makeUseCase(ledger, imports);

    const result = await acceptImportRow(row.id, { instrumentId: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'rowId')).toBeDefined();
    expect(await ledger.forUser(USER).listTransactions()).toHaveLength(0);
  });

  it('applies an override on a refresh-in-place re-import, keeping it idempotent on the same transaction', async () => {
    const { ledger, imports, account } = await setup();
    const { row: firstRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1000', currency('PLN')) }),
    );
    const acceptImportRow = makeUseCase(ledger, imports);
    const first = await acceptImportRow(firstRow.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalTransactionId = first.value.transactionId!;

    const { row: secondRow } = await seedRow(
      imports,
      account,
      cashRow({ externalId: 'row-1', grossAmount: Money.of('1250', currency('PLN')) }),
    );

    const second = await acceptImportRow(secondRow.id, { note: 'reviewed on re-import' });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe('accepted');
    expect(second.value.transactionId).toBe(originalTransactionId);

    const transactions = await ledger.forUser(USER).listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.id).toBe(originalTransactionId);
    expect(transactions[0]!.grossAmount?.equals(Money.of('1250', currency('PLN')))).toBe(true);
    expect(transactions[0]!.note).toBe('reviewed on re-import');
  });
});
