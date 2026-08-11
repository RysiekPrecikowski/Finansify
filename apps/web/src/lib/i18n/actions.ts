'use server';

import { cookies } from 'next/headers';

import { isLocale, localeCookie } from './locales';

const oneYearInSeconds = 60 * 60 * 24 * 365;

/**
 * Switching locale writes the cookie and lets the action's own revalidation
 * re-render the tree — the root layout reads the cookie, so every string on the
 * page follows without a client-side dictionary swap.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  (await cookies()).set(localeCookie, locale, {
    path: '/',
    maxAge: oneYearInSeconds,
    sameSite: 'lax',
  });
}
