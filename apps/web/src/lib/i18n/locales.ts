// The locale is stored in a cookie rather than the URL: there is one audience,
// and a `/[locale]/` segment would double every route for no gain. Server
// components read it with `getLocale()`; client components take it from context.

export const locales = ['pl', 'en'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'pl';

export const localeCookie = 'finansify_locale';

/** The BCP 47 tag handed to `Intl` — not the same thing as the UI locale. */
export const intlLocale: Record<Locale, string> = {
  pl: 'pl-PL',
  en: 'en-GB',
};

/** What the switcher shows for each locale. */
export const localeLabel: Record<Locale, string> = {
  pl: 'PL',
  en: 'EN',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
