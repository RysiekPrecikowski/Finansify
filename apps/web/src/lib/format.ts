import type { Money, Temporal } from '@finansify/core';

import { intlLocale, type Locale } from './i18n/locales';

/**
 * `Intl` accepts a decimal *string* and formats it at full precision, which is
 * what lets money reach the screen without ever becoming a `number` (ADR 0005).
 * TypeScript types that parameter as a numeric literal, so a string built at
 * runtime needs this cast — `Decimal.toFixed()` is exactly that shape.
 */
function numeric(value: string): Intl.StringNumericLiteral {
  return value as Intl.StringNumericLiteral;
}

/** Warsaw, not the viewer's zone: a Polish investor reads Polish market hours. */
const displayTimeZone = 'Europe/Warsaw';

export interface MoneyFormat {
  /** Drop the currency symbol — for columns that carry it in the header. */
  readonly bare?: boolean;
  /** `1,2 mln zł` instead of `1 234 567,89 zł`, for narrow screens. */
  readonly compact?: boolean;
  /** Always show `+` or `−`. For P&L, never for a value. */
  readonly signed?: boolean;
  readonly fractionDigits?: number;
}

export function formatMoney(money: Money, locale: Locale, format: MoneyFormat = {}): string {
  const fractionDigits = format.fractionDigits ?? (format.compact ? 1 : 2);

  return new Intl.NumberFormat(intlLocale[locale], {
    style: format.bare ? 'decimal' : 'currency',
    currency: money.currency,
    currencyDisplay: 'narrowSymbol',
    notation: format.compact ? 'compact' : 'standard',
    minimumFractionDigits: format.compact ? 0 : fractionDigits,
    maximumFractionDigits: fractionDigits,
    signDisplay: format.signed ? 'exceptZero' : 'auto',
    // pl-PL groups from five digits up by default, which makes `5796,00 zł` sit
    // in a column next to `38 682,00 zł`. In a table of money, always group.
    useGrouping: format.compact ? 'auto' : 'always',
  }).format(numeric(money.amount.toFixed(fractionDigits)));
}

/** Takes a ratio, not percentage points: `0.0639` renders as `+6,39%`. */
export function formatRatioAsPercent(
  ratio: string,
  locale: Locale,
  { signed = false }: { signed?: boolean } = {},
): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(numeric(ratio));
}

/** Share counts, not money: fractional shares are real, trailing zeroes are not. */
export function formatQuantity(quantity: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(numeric(quantity));
}

export function formatInstant(instant: Temporal.Instant, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: displayTimeZone,
  }).format(new Date(instant.epochMilliseconds));
}

export function formatPlainDate(date: Temporal.PlainDate, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: 'medium' }).format(
    new Date(date.toZonedDateTime(displayTimeZone).epochMilliseconds),
  );
}

/**
 * Which way a P&L figure points. The UI needs the direction, not the number —
 * green and red are reserved for exactly this (docs/ui.md).
 */
export type Direction = 'up' | 'down' | 'flat';

export function directionOf(money: Money): Direction {
  if (money.isPositive()) return 'up';
  if (money.isNegative()) return 'down';
  return 'flat';
}

export const directionText: Record<Direction, string> = {
  up: 'text-gain',
  down: 'text-loss',
  flat: 'text-muted-foreground',
};

export const directionSurface: Record<Direction, string> = {
  up: 'bg-gain/10 text-gain',
  down: 'bg-loss/10 text-loss',
  flat: 'bg-muted text-muted-foreground',
};
