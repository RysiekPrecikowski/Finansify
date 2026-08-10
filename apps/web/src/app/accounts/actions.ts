'use server';

import { createAccountSchema } from '@finansify/core';
import { createAccount } from '@finansify/db';
import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/server';

export async function createAccountAction(formData: FormData) {
  const userId = await requireUserId();

  const input = createAccountSchema.parse({
    name: formData.get('name'),
    baseCurrency: formData.get('baseCurrency'),
    wrapper: formData.get('wrapper') || undefined,
  });

  await createAccount(userId, input);
  revalidatePath('/accounts');
  revalidatePath('/');
}
