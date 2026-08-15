import { importBatchStatuses } from '@finansify/core/vocabulary';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { users } from './users';

export const importBatchStatusEnum = pgEnum('import_batch_status', importBatchStatuses);

/**
 * One uploaded statement. `docs/domain.md`'s "Imports" section is the source
 * for this shape: the raw file itself lives in Blob (private), never here —
 * this table is only what the review UI needs to render without touching Blob
 * again.
 *
 * `accountId` is `NOT NULL`: the account is chosen by the user at upload time,
 * never detected from the file (ADR 0015) — there is no "unassigned batch"
 * state to model.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Free text, same as `accounts.broker` — the set of parsers is adapter-registered, not domain vocabulary (ADR 0015). */
    broker: text('broker').notNull(),
    blobKey: text('blob_key').notNull(),
    status: importBatchStatusEnum('status').notNull().default('pending'),
    /** Set once `parse()` resolves; null while `status` is still `pending`. */
    failureReason: text('failure_reason'),
    /**
     * A snapshot taken once row processing is final, not a live-synced
     * counter — while a batch is under review, "how many rows are still
     * pending" is a query over `import_rows`, not a column here (see
     * `ImportBatchStatus`'s doc comment). These exist because `import_rows`
     * itself is pruned 90 days after acceptance (`docs/domain.md`), which is
     * the one point a derived count stops being derivable — after that, this
     * row is the only place "this import brought in 143 transactions" still
     * lives.
     */
    totalRows: integer('total_rows').notNull().default(0),
    acceptedRows: integer('accepted_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    /**
     * Statement-level findings from `ParsedStatement.warnings` (its own doc
     * comment explains why some findings have no single row to live on — a
     * ticker the statement's position snapshot reports as held with no
     * matching cash row anywhere in it). Discovered while wiring the upload
     * flow, not anticipated when this table was first designed.
     */
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('import_batches_user_id_idx').on(table.userId),
    index('import_batches_account_id_idx').on(table.accountId),
  ],
);

export type ImportBatchRow = typeof importBatches.$inferSelect;
export type NewImportBatchRow = typeof importBatches.$inferInsert;
