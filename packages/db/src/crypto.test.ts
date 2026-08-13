import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DecryptionError,
  MasterKeyError,
  generateDataKey,
  masterKeyFrom,
  rowCipherFor,
  unwrapDataKey,
  wrapDataKey,
} from './crypto';

const masterKey = randomBytes(32);
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

describe('masterKeyFrom', () => {
  it('accepts a 256-bit key', () => {
    expect(masterKeyFrom(masterKey.toString('base64'))).toHaveLength(32);
  });

  // A short key would encrypt happily and weaken every row in the database, so
  // this has to fail at startup rather than at rest.
  it('refuses a key that is not 256 bits', () => {
    expect(() => masterKeyFrom(randomBytes(16).toString('base64'))).toThrow(MasterKeyError);
  });
});

describe('data key wrapping', () => {
  it('unwraps to the same key', () => {
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(dataKey, masterKey, userA);

    expect(unwrapDataKey(wrapped, masterKey, userA).equals(dataKey)).toBe(true);
  });

  // The wrapped key is bound to its owner: lifting one user's row into
  // another's must not produce a usable key.
  it('refuses a wrapped key claimed by a different user', () => {
    const wrapped = wrapDataKey(generateDataKey(), masterKey, userA);

    expect(() => unwrapDataKey(wrapped, masterKey, userB)).toThrow(DecryptionError);
  });

  it('refuses a wrapped key under the wrong master key', () => {
    const wrapped = wrapDataKey(generateDataKey(), masterKey, userA);

    expect(() => unwrapDataKey(wrapped, randomBytes(32), userA)).toThrow(DecryptionError);
  });
});

describe('row payloads', () => {
  const dataKey = generateDataKey();
  const cipher = rowCipherFor(dataKey, userA);
  const amounts = { quantity: '120', fee: '19.00', note: 'first tranche' };

  it('round-trips a payload unchanged', () => {
    const sealed = cipher.encrypt(amounts, 'transactions', 'row-1');

    expect(cipher.decrypt(sealed, 'transactions', 'row-1')).toEqual(amounts);
  });

  it('keeps amounts out of the stored payload', () => {
    const sealed = cipher.encrypt(amounts, 'transactions', 'row-1');

    expect(sealed).not.toContain('120');
    expect(sealed).not.toContain('19.00');
    expect(sealed).not.toContain('first tranche');
  });

  // Same key, same user — so without the AAD this would decrypt perfectly and
  // silently restate one transaction's amounts as another's.
  it('refuses a payload replayed onto a different row', () => {
    const sealed = cipher.encrypt(amounts, 'transactions', 'row-1');

    expect(() => cipher.decrypt(sealed, 'transactions', 'row-2')).toThrow(DecryptionError);
  });

  it('refuses a payload replayed onto a different table', () => {
    const sealed = cipher.encrypt(amounts, 'transactions', 'row-1');

    expect(() => cipher.decrypt(sealed, 'accounts', 'row-1')).toThrow(DecryptionError);
  });

  it("refuses another user's payload even under the same data key", () => {
    const sealed = cipher.encrypt(amounts, 'transactions', 'row-1');

    expect(() => rowCipherFor(dataKey, userB).decrypt(sealed, 'transactions', 'row-1')).toThrow(
      DecryptionError,
    );
  });

  it('refuses a tampered payload rather than returning garbage', () => {
    const sealed = cipher.encrypt(amounts, 'transactions', 'row-1');
    const [prefix, encoded] = sealed.split(':', 2);
    const bytes = Buffer.from(encoded!, 'base64');
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 20) ^ 0xff, bytes.length - 20);

    expect(() =>
      cipher.decrypt(`${prefix}:${bytes.toString('base64')}`, 'transactions', 'row-1'),
    ).toThrow(DecryptionError);
  });

  it('refuses an unknown payload version', () => {
    expect(() => cipher.decrypt('9:abcdef', 'transactions', 'row-1')).toThrow(DecryptionError);
  });

  // Repeating the IV under one key would leak the relationship between two
  // equal amounts, which for a ledger is most of what the encryption is for.
  it('never reuses a nonce for identical input', () => {
    const sealed = new Set(
      Array.from({ length: 50 }, () => cipher.encrypt(amounts, 'transactions', 'row-1')),
    );

    expect(sealed.size).toBe(50);
  });
});
