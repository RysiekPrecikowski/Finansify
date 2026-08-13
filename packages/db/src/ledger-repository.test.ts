import { transactionInputSchema, userId as toUserId } from '@finansify/core';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { DecryptionError, generateDataKey, rowCipherFor } from './crypto';
import { canonical, canonicalOrNull, decodePayload, toRow } from './ledger-repository';

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

  // `Decimal` parses all three, and none of them throws on any later call —
  // a `NaN` quantity would make every comparison in `positions` false rather
  // than fail, so this is the one bad value that has to be caught here.
  it.each(['NaN', 'Infinity', '-Infinity'])('throws on the non-finite value %s', (value) => {
    expect(() => canonical(value)).toThrow(/finite/);
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
  // The message is asserted too: "missing" said of a field that is present but
  // holds a number sends whoever reads the log looking for the wrong thing.
  it.each([
    ['a non-object payload', 'not-an-object', /decrypted to string/],
    ['null', null, /decrypted to object/],
    ['a payload missing a required field', { ...valid, quantity: undefined }, /missing "quantity"/],
    ['a required field of the wrong type', { ...valid, fee: 42 }, /non-string "fee"/],
    ['an optional field of the wrong type', { ...valid, price: 42 }, /non-string "price"/],
    ['a note of the wrong type', { ...valid, note: 42 }, /non-string "note"/],
    [
      'a required amount that is not decimal',
      { ...valid, quantity: 'abc' },
      /unparseable "quantity"/,
    ],
    [
      'a required amount that is not finite',
      { ...valid, quantity: 'NaN' },
      /unparseable "quantity"/,
    ],
  ])('throws on %s', (_label, payload, message) => {
    expect(() => decodePayload(payload, rowId)).toThrow(message);
    expect(() => decodePayload(payload, rowId)).toThrow(/row-1/);
  });

  // Everything this function parses arrived by way of `cipher.decrypt`, so the
  // bad value is plaintext from an encrypted column. `Decimal`'s own error
  // quotes it, and Node prints a `cause` chain in default error output, so the
  // wrapper has to drop the cause rather than attach it.
  it('keeps the offending amount out of the error it throws', () => {
    const secret = '1234.5678-not-a-number';
    try {
      decodePayload({ ...valid, quantity: secret }, rowId);
      expect.unreachable('decodePayload should have thrown');
    } catch (error) {
      expect(inspect(error, { depth: null })).not.toContain(secret);
    }
  });
});

/**
 * The one path that exercises the encryption boundary end to end: an input
 * canonicalized, sealed, read back off the row, and decoded. `RowCipher` needs
 * only a key and a user id, so nothing here touches a database.
 */
describe('toRow and decodePayload round trip', () => {
  const userId = toUserId('11111111-1111-4111-8111-111111111111');
  const rowId = '33333333-3333-4333-8333-333333333333';
  const cipher = rowCipherFor(generateDataKey(), userId);

  const input = transactionInputSchema.parse({
    accountId: '22222222-2222-4222-8222-222222222222',
    type: 'buy',
    tradeDate: '2026-01-15',
    // Twelve decimal places: ADR 0013 claims the payload preserves more than
    // the NUMERIC(28, 10) column it replaced, and `1e2` proves the shorthand is
    // normalized on the way in rather than stored verbatim.
    quantity: '10.000000000005',
    price: '1e2',
    fee: '1.995',
    currency: 'PLN',
    note: 'first buy',
  });

  const row = toRow(input, userId, cipher, rowId);

  it('brings every amount back in canonical form', () => {
    expect(decodePayload(cipher.decrypt(row.encrypted, 'transactions', rowId), rowId)).toEqual({
      quantity: '10.000000000005',
      price: '100',
      grossAmount: null,
      fee: '1.995',
      tax: '0',
      fxRate: null,
      note: 'first buy',
    });
  });

  it('leaves no amount in the columns the database can read', () => {
    expect(JSON.stringify(row)).not.toContain('1.995');
    expect(JSON.stringify(row)).not.toContain('first buy');
  });

  // The AAD binding in `crypto.ts` is only worth anything if `toRow` seals
  // against the same id it writes to the `id` column.
  it('binds the payload to the row id it writes', () => {
    expect(row.id).toBe(rowId);
    expect(() =>
      cipher.decrypt(row.encrypted, 'transactions', '44444444-4444-4444-8444-444444444444'),
    ).toThrow(DecryptionError);
  });
});
