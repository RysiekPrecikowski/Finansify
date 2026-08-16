import { importRowStatuses } from '@finansify/core/vocabulary';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { importBatches } from './import-batches';
import { instruments } from './instruments';
import { transactions } from './transactions';

export const importRowStatusEnum = pgEnum('import_row_status', importRowStatuses);

/**
 * One statement line within a batch. `parsed` holds the `StatementParser`
 * output (`packages/core/src/ports/statement-parser.ts`) as JSON — a few
 * hundred bytes, so a 500-row statement stays well under a megabyte
 * (`docs/domain.md`). Its exact shape is the import use case's contract, not
 * this schema's: this column stays loosely typed until that ticket fixes the
 * serialized `ParsedRow` shape, the same way `matched_lot_ids` on
 * `transactions` was typed only once its shape was settled.
 *
 * Rows are pruned 90 days after their batch is fully accepted
 * (`docs/domain.md`) — `import_batches`' own summary counts are what survives
 * that prune, not this table.
 */
export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    parsed: jsonb('parsed').$type<Record<string, unknown>>().notNull(),
    status: importRowStatusEnum('status').notNull().default('pending'),
    // `set null`: a transaction this row produced outlives the row itself —
    // rows are pruned on a timer, transactions never are (ADR 0004).
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    // `set null`, not `cascade`: an instrument outliving the rows that once
    // pointed at it during resolution is the normal case — instruments are
    // global (ADR 0010) and nothing about pruning an import batch's rows
    // should touch them.
    resolvedInstrumentId: uuid('resolved_instrument_id').references(() => instruments.id, {
      onDelete: 'set null',
    }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('import_rows_batch_id_idx').on(table.batchId),
    uniqueIndex('import_rows_batch_row_index_idx').on(table.batchId, table.rowIndex),
  ],
);

export type ImportRowRow = typeof importRows.$inferSelect;
export type NewImportRowRow = typeof importRows.$inferInsert;
