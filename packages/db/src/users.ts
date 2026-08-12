import { and, eq, isNull } from 'drizzle-orm';

import { type Database } from './client';
import { generateDataKey, unwrapDataKey, wrapDataKey } from './crypto';
import { users, type UserRow } from './schema/users';

export interface AuthIdentity {
  readonly authProvider: string;
  readonly authSubject: string;
  readonly email: string;
}

function findByIdentity(
  db: Database,
  identity: Pick<AuthIdentity, 'authProvider' | 'authSubject'>,
) {
  return db.query.users.findFirst({
    where: and(
      eq(users.authProvider, identity.authProvider),
      eq(users.authSubject, identity.authSubject),
    ),
  });
}

/**
 * Looks up a user by their auth-provider identity, provisioning one on a miss.
 * This is the lazy provisioning ADR 0009 chooses over a signup webhook: every
 * request pays the same lookup either way, and there is only one creation path.
 *
 * `onConflictDoNothing` plus a re-read handles two concurrent first requests
 * from the same new user (e.g. two tabs) without a unique-constraint error.
 */
/**
 * Resolves this user's data key, generating one on first ledger access (ADR
 * 0013). Lazy for the same reason the `users` row itself is: one creation path,
 * and a user who has never opened the ledger has nothing to encrypt.
 *
 * The conditional `where` makes the insert idempotent under a race — two
 * concurrent first requests cannot each install a key and leave the loser's
 * rows unreadable, which would be a silent, permanent data loss.
 */
export async function ensureDataKey(
  db: Database,
  userId: string,
  masterKey: Buffer,
): Promise<Buffer> {
  const [existing] = await db
    .select({ wrapped: users.wrappedDataKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing === undefined) throw new Error(`No user ${userId} to resolve a data key for`);
  if (existing.wrapped !== null) return unwrapDataKey(existing.wrapped, masterKey, userId);

  const wrapped = wrapDataKey(generateDataKey(), masterKey, userId);
  const [installed] = await db
    .update(users)
    .set({ wrappedDataKey: wrapped, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.wrappedDataKey)))
    .returning({ wrapped: users.wrappedDataKey });

  if (installed?.wrapped !== null && installed?.wrapped !== undefined)
    return unwrapDataKey(installed.wrapped, masterKey, userId);

  const [afterRace] = await db
    .select({ wrapped: users.wrappedDataKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (afterRace?.wrapped === null || afterRace?.wrapped === undefined) {
    throw new Error(`Could not install a data key for user ${userId}`);
  }
  return unwrapDataKey(afterRace.wrapped, masterKey, userId);
}

export async function findOrCreateUser(db: Database, identity: AuthIdentity): Promise<UserRow> {
  const existing = await findByIdentity(db, identity);
  if (existing !== undefined) return existing;

  const [inserted] = await db
    .insert(users)
    .values(identity)
    .onConflictDoNothing({ target: [users.authProvider, users.authSubject] })
    .returning();

  if (inserted !== undefined) return inserted;

  const afterConflict = await findByIdentity(db, identity);
  if (afterConflict === undefined) {
    throw new Error('User provisioning failed: insert conflicted but no row was found afterward');
  }
  return afterConflict;
}
