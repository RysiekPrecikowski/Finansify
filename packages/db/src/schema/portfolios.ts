import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { users } from './users';

/**
 * A reporting grouping and nothing more: portfolios hold no transactions and no
 * balances of their own, they only decide which accounts a view sums over.
 */
export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('portfolios_user_id_idx').on(table.userId),
    // The default portfolio is created lazily on first access, the same way the
    // `users` row is (ADR 0009). Without this, two concurrent first requests
    // from one user leave two portfolios of the same name behind; with it, the
    // second insert conflicts and re-reads.
    uniqueIndex('portfolios_user_name_idx').on(table.userId, table.name),
  ],
);

/**
 * Membership is many-to-many: an account can appear in several portfolios and
 * belongs to none of them, so this cannot collapse into a `portfolio_id` column
 * on `accounts`. The pair *is* the row, which is why it is also the primary key
 * — a surrogate id would only add a second way to say the same thing.
 */
export const portfolioAccounts = pgTable(
  'portfolio_accounts',
  {
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.portfolioId, table.accountId] })],
);

export type PortfolioRow = typeof portfolios.$inferSelect;
export type NewPortfolioRow = typeof portfolios.$inferInsert;
export type PortfolioAccountRow = typeof portfolioAccounts.$inferSelect;
export type NewPortfolioAccountRow = typeof portfolioAccounts.$inferInsert;
