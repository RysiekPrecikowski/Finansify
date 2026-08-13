import { describe, expect, it } from 'vitest';

import { canonical, canonicalOrNull, decodePayload } from './ledger-repository';

/**
 * `canonical` and `decodePayload` are the guarantee that replaces
 * `NUMERIC(28, 10)` once amounts move into an encrypted payload (ADR 0013).
 * Pure string-in, string-out logic — no database needed to exercise it.
 */
describe('canonical', () => {
  it('normalizes an amount to Decimal.toFixed() form', () => {
    expect(canonical('123.4500000000')).toBe('123.45');
  });

  // NUMERIC(28,10) would have silently accepted this and stored `100000` — the
  // whole point of `canonical` is that the payload only ever holds the one
  // agreed form, not whatever shorthand a caller typed.
  it('normalizes scientific notation rather than storing it verbatim', () => {
    expect(canonical('1e5')).toBe('100000');
  });

  it('preserves a negative sign', () => {
    expect(canonical('-42.5')).toBe('-42.5');
  });

  it('throws on a value Decimal cannot parse', () => {
    expect(() => canonical('not-a-number')).toThrow();
  });

  it('throws on an empty string', () => {
    expect(() => canonical('')).toThrow();
  });
});

describe('canonicalOrNull', () => {
  it('passes null through unchanged', () => {
    expect(canonicalOrNull(null)).toBeNull();
  });

  it('canonicalizes a present value', () => {
    expect(canonicalOrNull('10.500')).toBe('10.5');
  });
});

describe('decodePayload', () => {
  const rowId = 'row-1';
  const valid = {
    quantity: '100',
    price: '10.50',
    grossAmount: null,
    fee: '1.99',
    tax: '0',
    fxRate: null,
    note: 'a note',
  };

  it('round-trips a well-formed payload', () => {
    expect(decodePayload(valid, rowId)).toEqual({
      quantity: '100',
      price: '10.5',
      grossAmount: null,
      fee: '1.99',
      tax: '0',
      fxRate: null,
      note: 'a note',
    });
  });

  it('treats an absent optional field the same as an explicit null', () => {
    const { grossAmount: _grossAmount, ...withoutGrossAmount } = valid;
    expect(decodePayload(withoutGrossAmount, rowId).grossAmount).toBeNull();
  });

  it('defaults note to null rather than throwing when it is missing', () => {
    const { note: _note, ...withoutNote } = valid;
    expect(decodePayload(withoutNote, rowId).note).toBeNull();
  });

  // Every one of these has to fail loudly with the row id attached, not defer
  // to a `Decimal` call somewhere downstream that no longer knows which row it
  // came from — that is the reason `decodePayload` exists instead of a cast.
  it.each([
    ['a non-object payload', 'not-an-object'],
    ['null', null],
    ['a payload missing a required field', { ...valid, quantity: undefined }],
    ['a required field of the wrong type', { ...valid, fee: 42 }],
    ['an optional field of the wrong type', { ...valid, price: 42 }],
    ['a required amount that is not decimal', { ...valid, quantity: 'abc' }],
  ])('throws on %s', (_label, payload) => {
    expect(() => decodePayload(payload, rowId)).toThrow(/row-1/);
  });
});
