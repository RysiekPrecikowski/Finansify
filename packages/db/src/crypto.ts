import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for the private half of the ledger (ADR 0013).
 *
 * Node's own `crypto` and nothing else: a managed KMS is not free, and ADR 0013
 * concludes that Stage 2 removes the need for one entirely — a key the server
 * never holds long-term is not a key a KMS has anything to protect.
 *
 * Two layers:
 *
 * - a **master key**, today read from the environment, which only ever wraps
 *   and unwraps data keys and never touches a row;
 * - a **data key (DEK)** per user, which encrypts that user's rows.
 *
 * Stage 2 replaces the master key with one derived from each user's ledger
 * passphrase in their browser. That re-wraps two DEKs and re-encrypts nothing,
 * which is the entire reason the envelope exists.
 */

const algorithm = 'aes-256-gcm';
const keyBytes = 32;
const ivBytes = 12; // 96 bits, the size GCM is specified for
const tagBytes = 16;

/**
 * Versioned so a future scheme — Stage 2's wrapping, a different cipher, a
 * rotated master key — can be told apart from this one on sight, instead of
 * being guessed at from a payload's length.
 */
const version = '1';

export class DecryptionError extends Error {
  constructor(context: string, cause?: unknown) {
    super(
      `Could not decrypt ${context}. The payload, its key, or the row it is bound to has changed.`,
    );
    this.name = 'DecryptionError';
    this.cause = cause;
  }
}

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterKeyError';
  }
}

/**
 * Reads the master key from its base64 form and refuses anything that is not
 * exactly 256 bits. A short key here would still "work" and would quietly
 * weaken every row in the database, so this fails loudly at startup instead.
 */
export function masterKeyFrom(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== keyBytes) {
    throw new MasterKeyError(
      `The master key must decode to ${keyBytes} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function generateDataKey(): Buffer {
  return randomBytes(keyBytes);
}

function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${version}:${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64')}`;
}

function open(key: Buffer, payload: string, aad: string, context: string): string {
  const [payloadVersion, encoded] = payload.split(':', 2);
  if (payloadVersion !== version || encoded === undefined) {
    throw new DecryptionError(`${context} (unknown payload version "${payloadVersion}")`);
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < ivBytes + tagBytes)
    throw new DecryptionError(`${context} (payload truncated)`);

  const iv = bytes.subarray(0, ivBytes);
  const tag = bytes.subarray(bytes.length - tagBytes);
  const ciphertext = bytes.subarray(ivBytes, bytes.length - tagBytes);

  try {
    const decipher = createDecipheriv(algorithm, key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (cause) {
    // GCM fails closed: a wrong key, a tampered byte, or a payload lifted from
    // another row all land here rather than returning plausible garbage.
    throw new DecryptionError(context, cause);
  }
}

/**
 * The user id is the AAD, so a wrapped key stolen from one `users` row cannot
 * be pasted into another and unwrapped there.
 */
export function wrapDataKey(dataKey: Buffer, masterKey: Buffer, userId: string): string {
  return seal(masterKey, dataKey.toString('base64'), `dek:${userId}`);
}

export function unwrapDataKey(wrapped: string, masterKey: Buffer, userId: string): Buffer {
  return Buffer.from(
    open(masterKey, wrapped, `dek:${userId}`, `the data key for user ${userId}`),
    'base64',
  );
}

/**
 * Binds a row's payload to exactly where it lives. Without this a ciphertext
 * could be copied from one transaction onto another — same key, same user, so
 * it would decrypt perfectly and silently restate an amount.
 */
function rowContext(userId: string, table: string, rowId: string): string {
  return `${userId}:${table}:${rowId}`;
}

export interface RowCipher {
  encrypt(value: unknown, table: string, rowId: string): string;
  decrypt<T>(payload: string, table: string, rowId: string): T;
}

/**
 * Encrypts one JSON payload per row rather than one per amount: every read path
 * loads the whole row and folds it in memory (ADR 0003), so there is no case
 * where a single amount is wanted alone, and seven ciphertexts would only mean
 * seven IVs and seven tags to serve the same read.
 */
export function rowCipherFor(dataKey: Buffer, userId: string): RowCipher {
  return {
    encrypt(value, table, rowId) {
      return seal(dataKey, JSON.stringify(value), rowContext(userId, table, rowId));
    },
    decrypt<T>(payload: string, table: string, rowId: string): T {
      return JSON.parse(
        open(dataKey, payload, rowContext(userId, table, rowId), `${table} row ${rowId}`),
      ) as T;
    },
  };
}
