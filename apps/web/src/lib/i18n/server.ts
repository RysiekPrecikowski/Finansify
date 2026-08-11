import { cookies } from 'next/headers';

import { dictionaryFor, type Dictionary } from './dictionaries';
import { defaultLocale, isLocale, localeCookie, type Locale } from './locales';

/**
 * The locale for this request. Reading a cookie opts the caller into dynamic
 * rendering — that is deliberate. The locale is a per-user choice, so it must
 * never be baked into a shared cached shell.
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(localeCookie)?.value;
  return isLocale(value) ? value : defaultLocale;
}

export async function getDictionary(): Promise<Dictionary> {
  return dictionaryFor(await getLocale());
}
