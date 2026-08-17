'use server';

import { cookies } from 'next/headers';

import {
  fxScopeCookie,
  fxSourceCookie,
  isFxScopeOption,
  isFxSourceOption,
  displayLinesCookie,
  displayTotalCookie,
  isDisplayCurrency,
  isLinesMode,
} from './currencies';

const oneYearInSeconds = 60 * 60 * 24 * 365;

/**
 * Two actions rather than one taking a partial: each switcher item changes
 * exactly one setting, and a partial update would need the caller to send back
 * the value it is not changing.
 *
 * Both write the cookie and let the action's own revalidation re-render — the
 * total is computed on the server, so there is nothing to swap client-side.
 */
export async function setDisplayTotal(code: string): Promise<void> {
  if (!isDisplayCurrency(code)) {
    throw new Error(`Unsupported display currency: ${code}`);
  }
  await write(displayTotalCookie, code);
}

export async function setDisplayLines(mode: string): Promise<void> {
  if (!isLinesMode(mode)) {
    throw new Error(`Unsupported line mode: ${mode}`);
  }
  await write(displayLinesCookie, mode);
}

async function write(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value, {
    path: '/',
    maxAge: oneYearInSeconds,
    sameSite: 'lax',
  });
}

export async function setFxSource(source: string): Promise<void> {
  if (!isFxSourceOption(source)) {
    throw new Error(`Unsupported FX source: ${source}`);
  }
  await write(fxSourceCookie, source);
}

export async function setFxScope(scope: string): Promise<void> {
  if (!isFxScopeOption(scope)) {
    throw new Error(`Unsupported FX scope: ${scope}`);
  }
  await write(fxScopeCookie, scope);
}
