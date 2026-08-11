'use client';

import { createContext, use, type ReactNode } from 'react';

import { type Dictionary } from './dictionaries';
import { type Locale } from './locales';

interface I18nValue {
  readonly locale: Locale;
  readonly dictionary: Dictionary;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Provided once in the root layout from the cookie-derived locale, so client
 * components get the same dictionary the server rendered with. Dictionaries are
 * plain objects, which is what lets them cross the boundary at all.
 */
export function I18nProvider({
  locale,
  dictionary,
  children,
}: Readonly<{ locale: Locale; dictionary: Dictionary; children: ReactNode }>) {
  return <I18nContext.Provider value={{ locale, dictionary }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = use(I18nContext);
  if (value === null) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return value;
}
