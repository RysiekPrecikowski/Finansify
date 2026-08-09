import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 1 schema: ownership and grouping only. The ledger arrives in Phase 2.
 * See docs/roadmap.md before adding tables here.
 *
 * Conventions, enforced by review:
 * - `userId` references `auth.users(id)` (Supabase Auth owns the users table).
 * - Every user-owned table has RLS enabled and a policy scoped to `auth.uid()`.
 * - Money is `numeric`, never `double precision`, and is read back as a string.
 * - Timestamps are `timestamptz`, always stored in UTC.
 */

export const currencyCode = pgEnum('currency_code', ['PLN', 'USD', 'EUR', 'GBP', 'CHF']);

export const accountWrapper = pgEnum('account_wrapper', ['TAXABLE', 'IKE', 'IKZE', 'PPK']);

export const auditAction = pgEnum('audit_action', ['CREATE', 'UPDATE', 'DELETE']);

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    name: text().notNull(),
    baseCurrency: currencyCode().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('portfolios_user_id_idx').on(table.userId),
    uniqueIndex('portfolios_user_id_name_key').on(table.userId, table.name),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    name: text().notNull(),
    /** An account has exactly one base currency. All its ledger entries normalize to it. */
    baseCurrency: currencyCode().notNull(),
    wrapper: accountWrapper().notNull().default('TAXABLE'),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    uniqueIndex('accounts_user_id_name_key').on(table.userId, table.name),
  ],
);

/**
 * An account may belong to many portfolios. Portfolios are reporting groups,
 * never the source of ownership -- which is why global views must aggregate over
 * the distinct account set, not over this join table. See docs/domain.md.
 */
export const portfolioAccounts = pgTable(
  'portfolio_accounts',
  {
    portfolioId: uuid()
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.portfolioId, table.accountId] }),
    index('portfolio_accounts_account_id_idx').on(table.accountId),
  ],
);

/** Append-only. Every mutation to a user-owned row writes one row here. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    action: auditAction().notNull(),
    before: jsonb(),
    after: jsonb(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_entity_idx').on(table.entityType, table.entityId),
    index('audit_events_user_id_occurred_at_idx').on(table.userId, table.occurredAt),
  ],
);

export const portfoliosRelations = relations(portfolios, ({ many }) => ({
  portfolioAccounts: many(portfolioAccounts),
}));

export const accountsRelations = relations(accounts, ({ many }) => ({
  portfolioAccounts: many(portfolioAccounts),
}));

export const portfolioAccountsRelations = relations(portfolioAccounts, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [portfolioAccounts.portfolioId],
    references: [portfolios.id],
  }),
  account: one(accounts, {
    fields: [portfolioAccounts.accountId],
    references: [accounts.id],
  }),
}));

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
