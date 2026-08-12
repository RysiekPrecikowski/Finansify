import { fxRateSources, transactionSources, transactionTypes } from '@finansify/core/vocabulary';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
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
 * The ledger: the system of record, from which positions, valuations and P&L are
 * derived on read and never stored (ADR 0003).
 *
 * **Every amount lives in `encrypted`, not in a column of its own** (ADR 0013).
 * `quantity`, `price`, `gross_amount`, `fee`, `tax`, `fx_rate` and the note are
 * one AES-256-GCM payload, bound by its AAD to this row's id and owner so a
 * ciphertext cannot be replayed onto another row. What remains in the clear is
 * only what the database itself has to act on: who owns the row, which account
 * and instrument it belongs to, when it happened, and whether it is deleted.
 *
 * This costs the `NUMERIC(28, 10)` guarantee that an amount is a number —
 * ciphertext is bytes, and a numeric column will not hold bytes. Validity now
 * rests on the adapter, which parses every amount through `Decimal` before
 * sealing it and re-parses on the way out.
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
    // Supplied by the adapter rather than defaulted here: the AAD binds the
    // payload to this id, so the id has to exist before the row is encrypted.
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
    /**
     * The transaction currency, which is not necessarily the account's. Left in
     * the clear because every amount in the payload is denominated in it, and
     * knowing the currency without the figures reveals nothing worth hiding.
     */
    currency: text('currency').notNull(),
    fxRateSource: fxRateSourceEnum('fx_rate_source'),
    /** `iv || ciphertext || tag`, base64, version-prefixed. See `src/crypto.ts`. */
    encrypted: text('encrypted').notNull(),
    source: transactionSourceEnum('source').notNull().default('manual'),
    externalId: text('external_id'),
    // No foreign key: `import_batches` does not exist until Phase 4.
    importBatchId: uuid('import_batch_id'),
    editedAfterImport: boolean('edited_after_import').notNull().default(false),
    /** Specific-lot selection on a sell; null means the strategy default. Ids,
     * not amounts, so there is nothing here worth encrypting. */
    matchedLotIds: jsonb('matched_lot_ids').$type<string[]>(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
