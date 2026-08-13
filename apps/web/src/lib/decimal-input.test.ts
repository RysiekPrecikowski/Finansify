import { describe, expect, it } from 'vitest';

import { normalizeDecimalInput } from './decimal-input';

// A Polish investor types `1 234,56`. Core's `decimalString` accepts neither the
// comma nor the separator, and must not — a lenient schema at the domain edge is
// how `Number()` creeps back in (rule 1, ADR 0005). Normalization is the UI
// edge's job, string to string, and it never parses.
//
// Built from code points rather than pasted in, because these characters are
// invisible in a diff: a reviewer has no way to tell U+00A0 from an ordinary
// space by looking at it.
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);
const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f);
const MINUS_SIGN = String.fromCodePoint(0x2212);

describe('normalizeDecimalInput', () => {
  // Three separators, because all three reach a real form: an ordinary space
  // from the keyboard, U+00A0 from a paste out of a bank statement, and U+202F
  // from `Intl.NumberFormat('pl-PL')` — which is what a value looks like when it
  // round-trips out of a formatted field and back in.
  it.each([
    ['an ordinary space', '1 234,56'],
    ['a no-break space', `1${NO_BREAK_SPACE}234,56`],
    ['a narrow no-break space', `1${NARROW_NO_BREAK_SPACE}234,56`],
  ])('strips %s used as a grouping separator and turns the comma into a dot', (_label, input) => {
    expect(normalizeDecimalInput(input)).toBe('1234.56');
  });

  // Asserted against the formatter's actual output rather than against a
  // hard-coded separator, so this keeps holding whichever space the running ICU
  // groups pl-PL with — Node 24 emits U+00A0 here, browsers have shipped U+202F.
  // The fixture is seven digits because pl-PL does not group a four-digit number
  // at all, and `1234,56` would prove nothing about separators. The numeric
  // literal is a formatter fixture, not an amount: nothing here does arithmetic.
  it('accepts back exactly what Intl.NumberFormat(pl-PL) produced', () => {
    const formatted = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2 }).format(
      1234560.56,
    );

    expect(normalizeDecimalInput(formatted)).toBe('1234560.56');
  });

  it('keeps the sign of a negative decimal-comma value', () => {
    expect(normalizeDecimalInput('-0,5')).toBe('-0.5');
  });

  it('leaves a dot-decimal input alone', () => {
    expect(normalizeDecimalInput('12.30')).toBe('12.30');
  });

  // Proof that this is a string rewrite and not a parse-and-reformat: a round
  // trip through a number would turn `10,00` into `10`.
  it('preserves trailing zeros rather than collapsing the value', () => {
    expect(normalizeDecimalInput('10,00')).toBe('10.00');
  });

  it('removes surrounding whitespace like any other separator', () => {
    expect(normalizeDecimalInput('  1 234,56  ')).toBe('1234.56');
  });

  // Anything it cannot normalize is passed through untouched and rejected
  // downstream by `decimalString`, which is where the error message belongs. A
  // normalizer that answers `''` or `'NaN'` destroys the very value the user has
  // to correct.
  it.each([
    ['letters', 'abc'],
    ['an empty string', ''],
  ])('passes %s through untouched instead of guessing', (_label, input) => {
    expect(normalizeDecimalInput(input)).toBe(input);
  });

  it('is total: any string in, a string out, never a throw', () => {
    const hostile = [
      '',
      ' ',
      NO_BREAK_SPACE,
      NARROW_NO_BREAK_SPACE,
      'abc',
      '1,2,3',
      '1.2.3',
      '--',
      ',,',
      '.',
      '-',
      'NaN',
      'Infinity',
      '1e5',
      `${MINUS_SIGN}5`,
      '\u{1F4B8}',
      '\n\t',
      '0'.repeat(1000),
      `1${NARROW_NO_BREAK_SPACE}234,56`,
    ];

    for (const value of hostile) {
      expect(() => normalizeDecimalInput(value)).not.toThrow();
      expect(typeof normalizeDecimalInput(value)).toBe('string');
    }
  });

  // A form that re-renders a normalized value and submits it again must land on
  // the same string, or an edit round trip would drift.
  it('is idempotent', () => {
    for (const value of ['1 234,56', `1${NO_BREAK_SPACE}234,56`, '12.30', 'abc', '', '-0,5']) {
      const once = normalizeDecimalInput(value);

      expect(normalizeDecimalInput(once)).toBe(once);
    }
  });
});
