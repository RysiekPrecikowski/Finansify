import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '../ledger/in-memory-ledger';
import { userId } from '../ports';
import { makeOpenAccount } from './open-account';
import { type FieldIssue } from './result';

const USER = userId('11111111-1111-4111-8111-111111111111');

const validInput = {
  name: 'XTB brokerage',
  broker: 'XTB',
  wrapper: 'brokerage',
  currency: 'PLN',
  openedAt: '2024-01-01',
};

function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

describe('makeOpenAccount', () => {
  it('creates and returns the account for a valid input', async () => {
    const ledger = new InMemoryLedger();
    const openAccount = makeOpenAccount({ ledger: ledger.forUser(USER) });

    const result = await openAccount(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('XTB brokerage');
    expect(result.value.broker).toBe('XTB');
    expect(result.value.wrapper).toBe('brokerage');
    expect(result.value.currency).toBe('PLN');

    const stored = await ledger.forUser(USER).listAccounts();
    expect(stored.map((account) => account.id)).toEqual([result.value.id]);
  });

  it('rejects a blank name and writes nothing', async () => {
    const ledger = new InMemoryLedger();
    const openAccount = makeOpenAccount({ ledger: ledger.forUser(USER) });

    const result = await openAccount({ ...validInput, name: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(issueAt(result.issues, 'name')).toBeDefined();
    expect(await ledger.forUser(USER).listAccounts()).toHaveLength(0);
  });

  it('rejects a currency that is not a three-letter code and writes nothing', async () => {
    const ledger = new InMemoryLedger();
    const openAccount = makeOpenAccount({ ledger: ledger.forUser(USER) });

    const result = await openAccount({ ...validInput, currency: 'zloty' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'currency')).toBeDefined();
    expect(await ledger.forUser(USER).listAccounts()).toHaveLength(0);
  });

  it('accepts a lower-case currency and stores it upper-cased', async () => {
    const ledger = new InMemoryLedger();
    const openAccount = makeOpenAccount({ ledger: ledger.forUser(USER) });

    const result = await openAccount({ ...validInput, currency: 'pln' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('PLN');
  });

  it('rejects an invalid calendar date for openedAt', async () => {
    const ledger = new InMemoryLedger();
    const openAccount = makeOpenAccount({ ledger: ledger.forUser(USER) });

    // 2026 is not a leap year: February has no 30th.
    const result = await openAccount({ ...validInput, openedAt: '2026-02-30' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueAt(result.issues, 'openedAt')).toBeDefined();
    expect(await ledger.forUser(USER).listAccounts()).toHaveLength(0);
  });
});
