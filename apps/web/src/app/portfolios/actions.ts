'use server';

import { createPortfolioSchema, linkAccountSchema } from '@finansify/core';
import { createPortfolio, linkAccountToPortfolio, unlinkAccountFromPortfolio } from '@finansify/db';
import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/server';

export async function createPortfolioAction(formData: FormData) {
  const userId = await requireUserId();

  const input = createPortfolioSchema.parse({
    name: formData.get('name'),
    baseCurrency: formData.get('baseCurrency'),
  });

  await createPortfolio(userId, input);
  revalidatePath('/portfolios');
}

export async function linkAccountAction(formData: FormData) {
  const userId = await requireUserId();

  const { portfolioId, accountId } = linkAccountSchema.parse({
    portfolioId: formData.get('portfolioId'),
    accountId: formData.get('accountId'),
  });

  await linkAccountToPortfolio(userId, portfolioId, accountId);
  revalidatePath(`/portfolios/${portfolioId}`);
  revalidatePath('/');
}

export async function unlinkAccountAction(formData: FormData) {
  const userId = await requireUserId();

  const { portfolioId, accountId } = linkAccountSchema.parse({
    portfolioId: formData.get('portfolioId'),
    accountId: formData.get('accountId'),
  });

  await unlinkAccountFromPortfolio(userId, portfolioId, accountId);
  revalidatePath(`/portfolios/${portfolioId}`);
  revalidatePath('/');
}
