// The presentation currency lives in a cookie for the same reason the locale
// does (`lib/i18n/locales.ts`): it is a per-reader choice with no place in the
// URL, and reading it opts a page into dynamic rendering, which is correct —
// a portfolio total must never come out of a shared cached shell.
//
// This module stays free of `@finansify/core` so the switcher can import it
// without pulling `decimal.js`, `zod` and the Temporal polyfill into the
// client bundle. The branded `Currency` is built on the server, in `server.ts`.

/**
 * Everything NBP table A carries, which is everything this app can convert at
 * all. Offering fewer would be an arbitrary limit, not a saving: `fetchTableTo`
 * pulls the **whole** table in one request and `refreshFxRates` stores every
 * row of it, so a rate for TRY is already on file the moment a rate for USD is.
 *
 * PLN leads because table A is PLN-based and has no row of its own; the four
 * after it are the ones anyone here actually holds, and the rest is
 * alphabetical. Verified against a live table on 2026-08-14 (32 rows + PLN).
 *
 * XDR is the IMF's basket rather than a currency anyone is paid in. It stays,
 * because table A quotes it and excluding it would be a judgement this list has
 * no business making.
 */
export const displayCurrencies = [
  'PLN',
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'AUD',
  'BRL',
  'CAD',
  'CLP',
  'CNY',
  'CZK',
  'DKK',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'UAH',
  'XDR',
  'ZAR',
] as const;

export type DisplayCurrencyCode = (typeof displayCurrencies)[number];

/** The five at the head of the list, kept together above a separator in every picker. */
export const commonCurrencies = displayCurrencies.slice(0, 5) as readonly DisplayCurrencyCode[];

export const defaultDisplayCurrency: DisplayCurrencyCode = 'PLN';

/**
 * Whether the per-position figures follow the total or stay in the currency
 * the instrument is priced in. Stored as a *mode* rather than as a second
 * currency: pinning a currency here would leave the lines on a stale one the
 * moment the total changed, which reads as a bug and is not what anyone meant
 * by picking it.
 */
export type LinesMode = 'native' | 'total';

/** A position in its own currency is the raw fact; that is the better default. */
export const defaultLinesMode: LinesMode = 'native';

export const displayTotalCookie = 'finansify_display_total';
export const displayLinesCookie = 'finansify_display_lines';

export function isDisplayCurrency(value: unknown): value is DisplayCurrencyCode {
  return typeof value === 'string' && (displayCurrencies as readonly string[]).includes(value);
}

export function isLinesMode(value: unknown): value is LinesMode {
  return value === 'native' || value === 'total';
}

export interface DisplaySettings {
  readonly total: DisplayCurrencyCode;
  readonly lines: LinesMode;
}

export const defaultDisplaySettings: DisplaySettings = {
  total: defaultDisplayCurrency,
  lines: defaultLinesMode,
};
