import { instrumentKinds } from '@finansify/core/vocabulary';
import { pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const instrumentKindEnum = pgEnum('instrument_kind', instrumentKinds);

/**
 * Global and unscoped on purpose: an instrument describes the world, not a user
 * (`docs/domain.md`). There is deliberately no `user_id` — adding one would fork
 * VOO into a row per user and make every price row user-scoped with it.
 *
 * Uniqueness on `(symbol, exchange)` is what makes the provider adapter's
 * upsert-by-symbol race-safe. It is a constraint rather than a plain unique
 * index so it can be `NULLS NOT DISTINCT`: `exchange` is nullable, and under
 * Postgres' default every NULL is its own value, so two concurrent upserts of an
 * unlisted symbol would both insert instead of one conflicting.
 */
export const instruments = pgTable(
  'instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: instrumentKindEnum('kind').notNull(),
    isin: text('isin'),
    symbol: text('symbol').notNull(),
    exchange: text('exchange'),
    currency: text('currency').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('instruments_symbol_exchange_key').on(table.symbol, table.exchange).nullsNotDistinct(),
  ],
);

export type InstrumentRow = typeof instruments.$inferSelect;
export type NewInstrumentRow = typeof instruments.$inferInsert;
