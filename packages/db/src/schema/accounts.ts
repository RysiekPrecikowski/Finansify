import { wrappers } from '@finansify/core/vocabulary';
import { date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Built from `core`'s array rather than a literal list, so the database enum and
 * the domain union cannot drift apart. Adding OKI in 2027 is one edit in `core`
 * plus the migration this file generates.
 */
export const wrapperEnum = pgEnum('wrapper', wrappers);

/**
 * `currency` is the account's *cash* currency, not the currency of what it
 * holds — a PLN account routinely holds USD ETFs. Every transaction carries its
 * own currency and the rate as executed, so nothing here is ever used to
 * reconstruct one (ADR 0006).
 *
 * `opened_at` and `closed_at` are `date`, not `timestamp`: an account opens on a
 * calendar day, and storing a calendar day as an instant is how it shifts by one
 * the first time a server runs in a different zone (ADR 0007).
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    broker: text('broker').notNull(),
    wrapper: wrapperEnum('wrapper').notNull(),
    currency: text('currency').notNull(),
    openedAt: date('opened_at', { mode: 'string' }).notNull(),
    closedAt: date('closed_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)],
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
