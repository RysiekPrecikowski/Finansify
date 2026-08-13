import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * `id` is our own UUID, never the provider's subject id — `auth_provider` and
 * `auth_subject` hold that instead, and nothing else in the schema references
 * a provider id. This is what turns an auth-provider migration into a single
 * backfilled column rather than a rewrite of every foreign key. See ADR 0009.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authProvider: text('auth_provider').notNull(),
    authSubject: text('auth_subject').notNull(),
    email: text('email').notNull(),
    /**
     * This user's data key, wrapped by the master key and bound to their id
     * (ADR 0013). Nullable because it is generated lazily on first ledger
     * access, like the row itself — a user who has never opened the ledger has
     * nothing to encrypt. The key material is never stored unwrapped.
     */
    wrappedDataKey: text('wrapped_data_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_auth_identity_idx').on(table.authProvider, table.authSubject)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
