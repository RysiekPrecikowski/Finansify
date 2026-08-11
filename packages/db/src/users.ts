import { and, eq } from 'drizzle-orm';

import { type Database } from './client';
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
