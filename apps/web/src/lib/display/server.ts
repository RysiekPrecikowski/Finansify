import { currency as toCurrency, type Currency, type DisplayCurrencies } from '@finansify/core';
import { cookies } from 'next/headers';

import {
  defaultFxPreference,
  fxScopeCookie,
  fxSourceCookie,
  isFxScopeOption,
  isFxSourceOption,
  type FxPreference,
  defaultDisplayCurrency,
  defaultLinesMode,
  displayLinesCookie,
  displayTotalCookie,
  isDisplayCurrency,
  isLinesMode,
  type DisplaySettings,
} from './currencies';

/**
 * The presentation currency for this request. An unrecognised cookie value
 * falls back rather than throwing — a cookie is reader-supplied input, and a
 * currency dropped from `displayCurrencies` would otherwise break the page for
 * everyone still carrying it.
 */
export async function getDisplaySettings(): Promise<DisplaySettings> {
  const jar = await cookies();
  const total = jar.get(displayTotalCookie)?.value;
  const lines = jar.get(displayLinesCookie)?.value;

  return {
    total: isDisplayCurrency(total) ? total : defaultDisplayCurrency,
    lines: isLinesMode(lines) ? lines : defaultLinesMode,
  };
}

/** The settings as `core` takes them: `'native'` stays a mode, `'total'` resolves to the currency. */
export function toDisplayCurrencies(settings: DisplaySettings): DisplayCurrencies {
  const total = toCurrency(settings.total);
  return { total, lines: settings.lines === 'native' ? 'native' : total };
}

/**
 * Every currency a render needs a rate for. The chosen total is in here even
 * when nothing in the portfolio is denominated in it — otherwise `ratesToPln`
 * has no row for it, and the total comes back as a partial sum of nothing.
 */
export function currenciesToRefresh(
  settings: DisplaySettings,
  held: readonly Currency[],
): readonly Currency[] {
  const pln = toCurrency('PLN');
  // PLN is excluded on purpose: NBP table A has no PLN row, and asking for one
  // leaves `fxDue` permanently true — see `open-positions.tsx`.
  return [...new Set([...held, toCurrency(settings.total)])].filter((code) => code !== pln);
}

/**
 * The FX source preference for this request, as `core` takes it.
 *
 * Unrecognised cookie values fall back rather than throwing, same as the
 * currency: this is reader-supplied input, and a preference dropped from the
 * options would otherwise break every page for anyone still carrying it.
 */
export async function getFxPreference(): Promise<FxPreference> {
  const jar = await cookies();
  const source = jar.get(fxSourceCookie)?.value;
  const scope = jar.get(fxScopeCookie)?.value;

  return {
    source: isFxSourceOption(source) ? source : defaultFxPreference.source,
    scope: isFxScopeOption(scope) ? scope : defaultFxPreference.scope,
  };
}
