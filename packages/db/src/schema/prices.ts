import { providerNames } from '@finansify/core/vocabulary';
import {
  date,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { instruments } from './instruments';

export const providerNameEnum = pgEnum('provider_name', providerNames);

/**
 * Global tables, no `user_id` — a price is a fact about the world, not about a
 * user (ADR 0010, same rule as `instruments`). See ADR 0014 for why exchange
 * is a mandatory coordinate for resolution and why ISIN is not: an instrument
 * only gets a row here once it has been resolved to exactly one listing.
 */
const decimalPrice = <TName extends string>(name: TName) =>
  numeric(name, { precision: 20, scale: 8, mode: 'string' });

/**
 * One instrument tied to one provider's symbol. `(provider, symbol)` is
 * unique so two instruments can never both claim the same ticker — the
 * scenario section 06 of the ingestion plan calls out as the real risk.
 */
export const instrumentIdentifiers = pgTable(
  'instrument_identifiers',
  {
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    provider: providerNameEnum('provider').notNull(),
    symbol: text('symbol').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.instrumentId, table.provider] }),
    unique('instrument_identifiers_provider_symbol_key').on(table.provider, table.symbol),
  ],
);

export type InstrumentIdentifierRow = typeof instrumentIdentifiers.$inferSelect;
export type NewInstrumentIdentifierRow = typeof instrumentIdentifiers.$inferInsert;

/**
 * One closing price per instrument per session day. `(instrument_id, date)`
 * is the primary key that makes naive concurrent upserts safe — two
 * simultaneous refreshes for the same instrument race harmlessly onto the
 * same row (ADR 0014, no fetch lock).
 */
export const instrumentPrices = pgTable(
  'instrument_prices',
  {
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(), // session date in the exchange's own timezone
    close: decimalPrice('close').notNull(),
    currency: text('currency').notNull(),
    source: providerNameEnum('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.instrumentId, table.date] })],
);

export type InstrumentPriceRow = typeof instrumentPrices.$inferSelect;
export type NewInstrumentPriceRow = typeof instrumentPrices.$inferInsert;

/**
 * One rate per currency per day **per source**. Rates are always *to PLN* —
 * cross pairs are computed on read (`convertViaPln`), never stored.
 *
 * `source` is part of the key rather than a label on the row because the two
 * feeds genuinely disagree: NBP fixes one mid around midday, Yahoo's daily
 * close is its own session's last tick, and they sit 7-22 bps apart (ADR 0017,
 * ADR 0018). With `(currency, date)` as the key, whichever refresh ran last
 * would overwrite the other and the stored series would silently alternate
 * between two definitions of "the rate".
 *
 * Everything that reads a rate therefore has to say which source it means.
 * That is the point — a query that does not name one is a question with two
 * different correct answers.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    currency: text('currency').notNull(),
    date: date('date', { mode: 'string' }).notNull(), // NBP's effectiveDate, or the session day
    mid: decimalPrice('mid').notNull(),
    source: providerNameEnum('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.currency, table.date, table.source] })],
);

export type FxRateRow = typeof fxRates.$inferSelect;
export type NewFxRateRow = typeof fxRates.$inferInsert;
