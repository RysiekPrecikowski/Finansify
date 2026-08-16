// The presentation currency lives in a cookie for the same reason the locale
// does (`lib/i18n/locales.ts`): it is a per-reader choice with no place in the
// URL, and reading it opts a page into dynamic rendering, which is correct —
// a portfolio total must never come out of a shared cached shell.
//
// This module stays free of `@finansify/core` so the switcher can import it
// without pulling `decimal.js`, `zod` and the Temporal polyfill into the
// client bundle. The branded `Currency` is built on the server, in `server.ts`.

/**
 * What the switcher offers. Deliberately short: every code here joins the set
 * of currencies refreshed from NBP table A on a `/portfolio` render, so the
 * list is a cost, not a menu. Table A carries far more — add one when someone
 * actually wants to read their portfolio in it.
 */
export const displayCurrencies = ['PLN', 'EUR', 'USD', 'GBP', 'CHF'] as const;

export type DisplayCurrencyCode = (typeof displayCurrencies)[number];

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
