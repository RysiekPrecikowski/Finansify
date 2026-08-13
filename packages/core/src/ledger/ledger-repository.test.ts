import { describe, expect, it } from 'vitest';

import { currency } from '../money';
import { userId, type UserId } from '../ports/session';
import { Temporal } from '../time';
import { InMemoryLedger, TransactionNotFoundError } from './in-memory-ledger';
import {
  transactionInputSchema,
  type Account,
  type AccountInput,
  type TransactionInput,
} from './types';

const PLN = currency('PLN');

const accountInput = (name: string): AccountInput => ({
  name,
  broker: 'XTB',
  wrapper: 'brokerage',
  currency: PLN,
  openedAt: Temporal.PlainDate.from('2024-01-01'),
});

const buyInput = (account: Account, tradeDate: string, quantity: string): TransactionInput =>
  transactionInputSchema.parse({
    accountId: account.id,
    type: 'buy',
    tradeDate,
    quantity,
    price: '100.00',
    currency: 'PLN',
  });

async function seed(ledger: InMemoryLedger, user: UserId, label: string) {
  const scoped = ledger.forUser(user);
  const account = await scoped.createAccount(accountInput(`${label} brokerage`));
  await scoped.ensureDefaultPortfolio(`${label} portfolio`);
  const first = await scoped.createTransaction(buyInput(account, '2024-02-01', '10'));
  const second = await scoped.createTransaction(buyInput(account, '2024-03-01', '20'));
  return { scoped, account, first, second };
}

describe('LedgerRepository scoping', () => {
  it('shows each user only their own accounts', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    expect((await a.scoped.listAccounts()).map((item) => item.id)).toEqual([a.account.id]);
    expect((await b.scoped.listAccounts()).map((item) => item.id)).toEqual([b.account.id]);
  });

  it('gives each user their own default portfolio rather than sharing one', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    const [portfolioA] = await a.scoped.listPortfolios();
    const [portfolioB] = await b.scoped.listPortfolios();

    expect(await a.scoped.listPortfolios()).toHaveLength(1);
    expect(await b.scoped.listPortfolios()).toHaveLength(1);
    expect(portfolioA!.id).not.toBe(portfolioB!.id);
    // Called twice, it must return the same one and not provision a second.
    expect((await a.scoped.ensureDefaultPortfolio('again')).id).toBe(portfolioA!.id);
    expect(await a.scoped.listPortfolios()).toHaveLength(1);
  });

  it('shows each user only their own transactions', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    expect((await a.scoped.listTransactions()).map((item) => item.id)).toEqual([
      a.first.id,
      a.second.id,
    ]);
    expect((await b.scoped.listTransactions()).map((item) => item.id)).toEqual([
      b.first.id,
      b.second.id,
    ]);
    expect(ledger.rawRowCount()).toBe(4);
  });

  it('refuses to fetch a transaction belonging to another user', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    // Knowing the id is not authorisation: there is no unscoped read path.
    expect(await a.scoped.getTransaction(b.first.id)).toBeNull();
    expect(await b.scoped.getTransaction(a.first.id)).toBeNull();
    expect(await a.scoped.getTransaction(a.first.id)).not.toBeNull();
  });

  it('refuses to update a transaction belonging to another user', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    await expect(
      a.scoped.updateTransaction(b.first.id, buyInput(a.account, '2024-02-01', '999')),
    ).rejects.toThrow(TransactionNotFoundError);

    const untouched = await b.scoped.getTransaction(b.first.id);
    expect(untouched!.quantity.equals(10)).toBe(true);
  });

  it('refuses to soft-delete a transaction belonging to another user', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    await expect(a.scoped.softDeleteTransaction(b.first.id)).rejects.toThrow(
      TransactionNotFoundError,
    );
    expect(ledger.isDeleted(b.first.id)).toBe(false);
    expect(await b.scoped.listTransactions()).toHaveLength(2);
  });

  it('hides a soft-deleted row from its owner and leaves the other user alone', async () => {
    const ledger = new InMemoryLedger();
    const a = await seed(ledger, userId('11111111-1111-4111-8111-111111111111'), 'A');
    const b = await seed(ledger, userId('22222222-2222-4222-8222-222222222222'), 'B');

    await a.scoped.softDeleteTransaction(a.first.id);

    expect((await a.scoped.listTransactions()).map((item) => item.id)).toEqual([a.second.id]);
    expect(await a.scoped.getTransaction(a.first.id)).toBeNull();
    expect(await b.scoped.listTransactions()).toHaveLength(2);
    // Soft, not hard: import idempotency depends on the row surviving (ADR 0004).
    expect(ledger.rawRowCount()).toBe(4);
  });
});
