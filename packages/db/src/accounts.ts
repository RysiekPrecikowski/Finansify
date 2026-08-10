import { and, eq, notInArray } from 'drizzle-orm';
import type { CreateAccountInput } from '@finansify/core';

import { db } from './client';
import { accounts, auditEvents, portfolioAccounts, portfolios } from './schema';

export function listAccounts(userId: string) {
  return db.query.accounts.findMany({
    where: eq(accounts.userId, userId),
    orderBy: (account, { asc }) => [asc(account.name)],
  });
}

export function createAccount(userId: string, input: CreateAccountInput) {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(accounts)
      .values({
        userId,
        name: input.name,
        baseCurrency: input.baseCurrency,
        wrapper: input.wrapper,
      })
      .returning();
    // A single-row insert always returns exactly one row; Drizzle just can't type it that way.
    const account = inserted!;

    await tx.insert(auditEvents).values({
      userId,
      entityType: 'account',
      entityId: account.id,
      action: 'CREATE',
      before: null,
      after: account,
    });

    return account;
  });
}

/** Returns null if the portfolio doesn't exist or isn't owned by `userId`. */
export async function listAccountsForPortfolio(userId: string, portfolioId: string) {
  const [portfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.userId, userId), eq(portfolios.id, portfolioId)));

  if (!portfolio) return null;

  const links = await db.query.portfolioAccounts.findMany({
    where: eq(portfolioAccounts.portfolioId, portfolioId),
    with: { account: true },
  });

  return { portfolio, accounts: links.map((link) => link.account) };
}

/** Accounts owned by `userId` not yet linked to `portfolioId`. */
export async function listUnlinkedAccounts(userId: string, portfolioId: string) {
  const links = await db.query.portfolioAccounts.findMany({
    where: eq(portfolioAccounts.portfolioId, portfolioId),
    columns: { accountId: true },
  });
  const linkedIds = links.map((link) => link.accountId);

  return db.query.accounts.findMany({
    where:
      linkedIds.length > 0
        ? and(eq(accounts.userId, userId), notInArray(accounts.id, linkedIds))
        : eq(accounts.userId, userId),
    orderBy: (account, { asc }) => [asc(account.name)],
  });
}

export function linkAccountToPortfolio(userId: string, portfolioId: string, accountId: string) {
  return db.transaction(async (tx) => {
    const [portfolio] = await tx
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.userId, userId), eq(portfolios.id, portfolioId)));
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)));

    if (!portfolio || !account) {
      throw new Error('Portfolio or account not found for this user.');
    }

    await tx.insert(portfolioAccounts).values({ portfolioId, accountId });

    await tx.insert(auditEvents).values({
      userId,
      entityType: 'portfolio_account',
      entityId: portfolioId,
      action: 'CREATE',
      before: null,
      after: { accountId },
    });
  });
}

export function unlinkAccountFromPortfolio(userId: string, portfolioId: string, accountId: string) {
  return db.transaction(async (tx) => {
    const [portfolio] = await tx
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.userId, userId), eq(portfolios.id, portfolioId)));

    if (!portfolio) {
      throw new Error('Portfolio not found for this user.');
    }

    await tx
      .delete(portfolioAccounts)
      .where(
        and(
          eq(portfolioAccounts.portfolioId, portfolioId),
          eq(portfolioAccounts.accountId, accountId),
        ),
      );

    await tx.insert(auditEvents).values({
      userId,
      entityType: 'portfolio_account',
      entityId: portfolioId,
      action: 'DELETE',
      before: { accountId },
      after: null,
    });
  });
}
