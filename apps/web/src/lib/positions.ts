import { MixedCurrencyPositionError, type PositionsView } from '@finansify/core';

/**
 * `MixedCurrencyPositionError` is an expected error (ADR 0021 calls the case
 * it guards "deliberately unsupported"), not a bug — Next's own guidance for
 * a Server Component data read is to catch it and render a message, not let
 * it fall through to the framework's generic error boundary, which redacts
 * the message in production anyway (`node_modules/next/dist/docs/.../
 * 10-error-handling.md`, "Handling expected errors").
 */
export type PositionsResult =
  | { readonly ok: true; readonly view: PositionsView }
  | { readonly ok: false; readonly mixedCurrency: true };

export async function loadPositions(
  listPositions: () => Promise<PositionsView>,
): Promise<PositionsResult> {
  try {
    return { ok: true, view: await listPositions() };
  } catch (error) {
    if (error instanceof MixedCurrencyPositionError) return { ok: false, mixedCurrency: true };
    throw error;
  }
}
