/**
 * `1 234,56` → `1234.56`.
 *
 * Strings only, in and out. This is the edge that keeps `Number()` out of
 * `core` (rule 1, ADR 0005), so it must never parse: a round trip through a
 * number would turn `10,00` into `10` and `0,1` into something that is not
 * `0.1` at all.
 *
 * Anything it cannot normalize is passed through **unchanged** and rejected by
 * `decimalString`, which is where the error message belongs. Answering `''` or
 * `'NaN'` here would destroy the very value the user has to correct.
 *
 * The separator class is spelled out rather than left to `\s`: an ordinary
 * space comes from the keyboard, U+00A0 from a paste out of a bank statement,
 * and U+202F from `Intl.NumberFormat` — which is what a value looks like when
 * it round-trips out of a formatted field and back in. `\s` does happen to
 * cover all three, but naming them says why they are here.
 *
 * Only the first comma becomes a dot. A second one means the input was never a
 * Polish decimal — `1,234.56` from a US statement stays malformed and is
 * refused downstream, rather than being quietly reinterpreted as a different
 * number.
 */
export function normalizeDecimalInput(value: string): string {
  return value.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
}
