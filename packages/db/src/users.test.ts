import { describe, expect, it, vi } from 'vitest';

import { type Database } from './client';
import { type UserRow } from './schema/users';
import { findOrCreateUser } from './users';

const identity = {
  authProvider: 'clerk' as const,
  authSubject: 'user_123',
  email: 'a@example.com',
};

const row: UserRow = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  authProvider: 'clerk',
  authSubject: 'user_123',
  email: 'a@example.com',
  wrappedDataKey: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

// findOrCreateUser only calls db.query.users.findFirst and db.insert(...); this
// mock provides just enough of Database's shape to drive those two paths
// without a real connection.
function makeDb(options: {
  findFirstResults: Array<UserRow | undefined>;
  insertReturning: UserRow[];
}): Database {
  const findFirst = vi.fn();
  for (const result of options.findFirstResults) {
    findFirst.mockResolvedValueOnce(result);
  }

  const returning = vi.fn().mockResolvedValue(options.insertReturning);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  return { query: { users: { findFirst } }, insert } as unknown as Database;
}

describe('findOrCreateUser', () => {
  it('returns the existing row on a hit, without inserting', async () => {
    const db = makeDb({ findFirstResults: [row], insertReturning: [] });

    await expect(findOrCreateUser(db, identity)).resolves.toEqual(row);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts and returns the new row on a clean miss', async () => {
    const db = makeDb({ findFirstResults: [undefined], insertReturning: [row] });

    await expect(findOrCreateUser(db, identity)).resolves.toEqual(row);
  });

  it('re-reads instead of throwing when a concurrent insert wins the race', async () => {
    const db = makeDb({ findFirstResults: [undefined, row], insertReturning: [] });

    await expect(findOrCreateUser(db, identity)).resolves.toEqual(row);
  });

  it('throws if the conflicted insert cannot be found on re-read', async () => {
    const db = makeDb({ findFirstResults: [undefined, undefined], insertReturning: [] });

    await expect(findOrCreateUser(db, identity)).rejects.toThrow('User provisioning failed');
  });
});
