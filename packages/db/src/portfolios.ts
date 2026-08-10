import { eq } from 'drizzle-orm';
import type { CreatePortfolioInput } from '@finansify/core';

import { db } from './client';
import { auditEvents, portfolios } from './schema';

export function listPortfolios(userId: string) {
  return db.query.portfolios.findMany({
    where: eq(portfolios.userId, userId),
    with: { portfolioAccounts: true },
    orderBy: (portfolio, { asc }) => [asc(portfolio.name)],
  });
}

export function createPortfolio(userId: string, input: CreatePortfolioInput) {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(portfolios)
      .values({ userId, name: input.name, baseCurrency: input.baseCurrency })
      .returning();
    // A single-row insert always returns exactly one row; Drizzle just can't type it that way.
    const portfolio = inserted!;

    await tx.insert(auditEvents).values({
      userId,
      entityType: 'portfolio',
      entityId: portfolio.id,
      action: 'CREATE',
      before: null,
      after: portfolio,
    });

    return portfolio;
  });
}
