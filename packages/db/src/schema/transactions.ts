import { fxRateSources, transactionSources, transactionTypes } from '@finansify/core/vocabulary';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { instruments } from './instruments';
import { users } from './users';

export const transactionTypeEnum = pgEnum('transaction_type', transactionTypes);
export const fxRateSourceEnum = pgEnum('fx_rate_source', fxRateSources);
export const transactionSourceEnum = pgEnum('transaction_source', transactionSources);

/**
 * `NUMERIC(28, 10)` for every amount and quantity, never `double precision`: a
 * binary float cannot represent 0.1, and a cost basis is a sum of thousands of
 * them (ADR 0005). Drizzle's `string` mode is kept deliberately so the value
 * reaches `core` as a string and becomes a `Decimal` there — no `Number()` is
 * ever in the path.
 */
const amount = <TName extends string>(name: TName) =>
  numeric(name, { precision: 28, scale: 10, mode: 'string' });

/**
 * The ledger: the system of record, from which positions, valuations and P&L are
 * derived on read and never stored (ADR 0003).
 *
 * `trade_date` and `settle_date` are `date`, not `timestamp`. A trade happens on
 * a calendar day; storing it as an instant is how a trade booked late on the
 * 31st becomes a January trade for tax purposes (ADR 0007).
 *
 * The row is mutable and soft-deletable — a correction is an `UPDATE`, not a
 * reversal entry (ADR 0004). Two guardrails carry that: the partial unique index
 * on `(account_id, external_id)`, so re-importing a statement never duplicates
 * or resurrects a row, and `edited_after_import`, so a hand-corrected row shows
 * up in a later import as a conflict rather than being silently overwritten.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // Null for pure cash movements. `restrict` rather than `cascade`: an
    // instrument is global, so deleting one must never reach into a user's
    // ledger.
    instrumentId: uuid('instrument_id').references(() => instruments.id, { onDelete: 'restrict' }),
    type: transactionTypeEnum('type').notNull(),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(),
    settleDate: date('settle_date', { mode: 'string' }),
    quantity: amount('quantity').notNull(),
    price: amount('price'),
    grossAmount: amount('gross_amount'),
    fee: amount('fee').notNull(),
    tax: amount('tax').notNull(),
    /** The transaction currency, which is not necessarily the account's. */
    currency: text('currency').notNull(),
    fxRate: amount('fx_rate'),
    fxRateSource: fxRateSourceEnum('fx_rate_source'),
    source: transactionSourceEnum('source').notNull().default('manual'),
    externalId: text('external_id'),
    // No foreign key: `import_batches` does not exist until Phase 4.
    importBatchId: uuid('import_batch_id'),
    editedAfterImport: boolean('edited_after_import').notNull().default(false),
    /** Specific-lot selection on a sell; null means the strategy default. */
    matchedLotIds: jsonb('matched_lot_ids').$type<string[]>(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (table) => [
    // Partial, because `external_id` is null for every manually entered row and
    // those must not collide with each other.
    uniqueIndex('transactions_account_external_id_idx')
      .on(table.accountId, table.externalId)
      .where(sql`external_id IS NOT NULL`),
    index('transactions_user_account_trade_date_idx').on(
      table.userId,
      table.accountId,
      table.tradeDate,
    ),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
