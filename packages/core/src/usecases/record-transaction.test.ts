import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { instrumentId, type Account } from '../ledger';
import { InMemoryLedger } from '../ledger/in-memory-ledger';
import { currency, Money } from '../money';
import { userId } from '../ports';
import { buildCashBalances } from '../positions/build-cash-balances';
import { Temporal } from '../time';
import {
  makeDeleteTransaction,
  makeRecordTransaction,
  makeUpdateTransaction,
} from './record-transaction';
import { type FieldIssue } from './result';

const INSTRUMENT = instrumentId('44444444-4444-4444-8444-444444444444');

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

/** Untyped on purpose: `recordTransaction`/`updateTransaction` take `unknown`. */
function buyInput(
  account: Account,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    accountId: account.id,
    instrumentId: INSTRUMENT,
    type: 'buy',
    tradeDate: '2024-02-01',
    quantity: '10',
    price: '100.00',
    currency: account.currency,
    ...overrides,
  };
}

/**
 * Two users, three accounts: a PLN and a USD account for the caller (`userA`),
 * plus one PLN account owned by `userB` to exercise the ownership check —
 * ownership is enforced by looking the account up via the caller's own
 * `listAccounts()`, so `userB`'s account is simply absent from `userA`'s view.
 */
async function setup() {
  const ledger = new InMemoryLedger();
  const userA = userId('11111111-1111-4111-8111-111111111111');
  const userB = userId('22222222-2222-4222-8222-222222222222');

  const plnAccount = await ledger.forUser(userA).createAccount({
    name: 'A PLN brokerage',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: currency('PLN'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });
  const usdAccount = await ledger.forUser(userA).createAccount({
    name: 'A USD brokerage',
    broker: 'IBKR',
    wrapper: 'brokerage',
    currency: currency('USD'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });
  const foreignAccount = await ledger.forUser(userB).createAccount({
    name: 'B PLN brokerage',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: currency('PLN'),
    openedAt: Temporal.PlainDate.from('2024-01-01'),
  });

  return { ledger, userA, userB, plnAccount, usdAccount, foreignAccount };
}

describe('makeRecordTransaction', () => {
  it('creates a PLN buy on a PLN account and lists it for the same user', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(buyInput(plnAccount));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = await ledger.forUser(userA).listTransactions();
    expect(stored.map((transaction) => transaction.id)).toEqual([result.value.id]);
  });

  it('refuses a transaction on an account owned by another user and writes nothing', async () => {
    const { ledger, userA, foreignAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(buyInput(foreignAccount));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'accountId')).toBeDefined();
    expect(await ledger.forUser(userA).listTransactions()).toHaveLength(0);
  });

  // ADR 0021: a currency difference no longer implies a conversion happened at
  // this transaction — BOŚ settles a EUR buy out of a EUR sub-balance funded
  // by an earlier, separate exchange. The position engine holds the cost
  // basis in USD, not the account's PLN.
  it('creates a USD buy on a PLN account with no rate — the basis stays in USD', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(buyInput(plnAccount, { currency: 'USD' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe(currency('USD'));
    expect(result.value.fxRate).toBeNull();
  });

  // Rule 6 (root CLAUDE.md) / ADR 0006: wherever a rate IS recorded, its
  // provenance must be too — never store a rate with no source, or vice versa.
  it('refuses a rate given with no source, and writes nothing', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(
      buyInput(plnAccount, { currency: 'USD', fxRate: '4.05' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'fxRateSource')).toBeDefined();
    expect(await ledger.forUser(userA).listTransactions()).toHaveLength(0);
  });

  it('creates a USD buy on a PLN account once fxRate and fxRateSource are given', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(
      buyInput(plnAccount, { currency: 'USD', fxRate: '4.05', fxRateSource: 'broker' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fxRate).not.toBeNull();
    expect(result.value.fxRate!.equals(new Decimal('4.05'))).toBe(true);
  });

  it('accepts a lower-case currency that matches the account currency case-insensitively', async () => {
    const { ledger, userA, usdAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(buyInput(usdAccount, { currency: 'usd' }));

    expect(result.ok).toBe(true);
  });

  it.each(['abc', 'NaN', 'Infinity'])(
    'rejects a non-finite-decimal quantity %s',
    async (quantity) => {
      const { ledger, userA, plnAccount } = await setup();
      const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

      const result = await recordTransaction(buyInput(plnAccount, { quantity }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(issueAt(result.issues, 'quantity')).toBeDefined();
    },
  );

  it('creates a transaction when fee is omitted, defaulting it to zero', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(buyInput(plnAccount));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fee.equals(Money.of('0', plnAccount.currency))).toBe(true);
  });

  it('rejects an explicit null fee — the caller must omit the key, not send null', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction(buyInput(plnAccount, { fee: null }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'fee')).toBeDefined();
  });

  it('records a deposit that round-trips through buildCashBalances', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });

    const result = await recordTransaction({
      accountId: plnAccount.id,
      type: 'deposit',
      instrumentId: null,
      tradeDate: '2024-02-01',
      quantity: '0',
      grossAmount: '1000',
      currency: 'PLN',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const transactions = await ledger.forUser(userA).listTransactions();
    const balances = buildCashBalances(transactions);
    const balance = balances.find(
      (item) => item.accountId === plnAccount.id && item.currency === plnAccount.currency,
    );
    expect(balance?.amount.equals(Money.of('1000', plnAccount.currency))).toBe(true);
  });
});

describe('makeUpdateTransaction', () => {
  it('replaces every field on the existing transaction', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });
    const updateTransaction = makeUpdateTransaction({ ledger: ledger.forUser(userA) });

    const created = await recordTransaction(buyInput(plnAccount));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateTransaction(
      created.value.id,
      buyInput(plnAccount, { quantity: '25', tradeDate: '2024-03-15', price: '150.00' }),
    );

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.quantity.equals(new Decimal('25'))).toBe(true);
    expect(updated.value.tradeDate.toString()).toBe('2024-03-15');
    expect(updated.value.price?.equals(Money.of('150.00', plnAccount.currency))).toBe(true);
  });
});

describe('makeDeleteTransaction', () => {
  it('soft-deletes: hidden from listTransactions, absent from getTransaction', async () => {
    const { ledger, userA, plnAccount } = await setup();
    const recordTransaction = makeRecordTransaction({ ledger: ledger.forUser(userA) });
    const deleteTransaction = makeDeleteTransaction({ ledger: ledger.forUser(userA) });

    const created = await recordTransaction(buyInput(plnAccount));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteTransaction(created.value.id);

    expect(result.ok).toBe(true);
    expect(await ledger.forUser(userA).listTransactions()).toHaveLength(0);
    expect(await ledger.forUser(userA).getTransaction(created.value.id)).toBeNull();
  });
});
