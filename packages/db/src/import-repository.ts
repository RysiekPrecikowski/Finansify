import {
  accountId as toAccountId,
  currency as toCurrency,
  importBatchId as toImportBatchId,
  importRowId as toImportRowId,
  instrumentId as toInstrumentId,
  Money,
  Temporal,
  transactionId as toTransactionId,
  type CreateImportBatchInput,
  type FxRateSource,
  type ImportBatch,
  type ImportBatchId,
  type ImportRepository,
  type ImportRow,
  type ImportRowId,
  type ImportRowOutcome,
  type InstrumentResolution,
  type ParsedInstrumentCandidate,
  type ParsedRow,
  type ScopedImportRepository,
  type TransactionType,
  type UserId,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { type Database } from './client';
import { importBatches, type ImportBatchRow } from './schema/import-batches';
import { importRows, type ImportRowRow } from './schema/import-rows';

/**
 * `import_rows.parsed` stores exactly this shape — the same fields
 * `ParsedRow` has, with every `Money`/`Decimal`/`Temporal.PlainDate` reduced
 * to a plain string the way `Money#toString()`'s own convention does
 * elsewhere in this codebase. Round-tripped only through
 * `serializeParsedRow`/`deserializeParsedRow` below; nothing else in this
 * file touches the JSON shape directly.
 */
function serializeParsedRow(row: ParsedRow): Record<string, unknown> {
  return {
    externalId: row.externalId,
    instrument: row.instrument,
    type: row.type,
    tradeDate: row.tradeDate.toString(),
    settleDate: row.settleDate?.toString() ?? null,
    quantity: row.quantity.toString(),
    price: row.price?.amount.toString() ?? null,
    grossAmount: row.grossAmount?.amount.toString() ?? null,
    fee: row.fee.amount.toString(),
    tax: row.tax.amount.toString(),
    currency: row.currency,
    fxRate: row.fxRate?.toString() ?? null,
    fxRateSource: row.fxRateSource,
    note: row.note,
    warnings: [...row.warnings],
  };
}

/**
 * The inverse of `serializeParsedRow`. Cast rather than `zod`-validated: this
 * JSON is never user-submitted directly, only ever round-tripped through
 * `serializeParsedRow` first — a shape mismatch here is a bug in that
 * function or in a hand-edited row, not untrusted input to defend against.
 */
function deserializeParsedRow(json: Record<string, unknown>): ParsedRow {
  const currency = toCurrency(json.currency as string);
  const money = (value: unknown): Money | null =>
    value === null ? null : Money.of(value as string, currency);

  return {
    externalId: json.externalId as string,
    instrument: json.instrument as ParsedInstrumentCandidate | null,
    type: json.type as TransactionType,
    tradeDate: Temporal.PlainDate.from(json.tradeDate as string),
    settleDate:
      json.settleDate === null ? null : Temporal.PlainDate.from(json.settleDate as string),
    quantity: new Decimal(json.quantity as string),
    price: money(json.price),
    grossAmount: money(json.grossAmount),
    fee: Money.of(json.fee as string, currency),
    tax: Money.of(json.tax as string, currency),
    currency,
    fxRate: json.fxRate === null ? null : new Decimal(json.fxRate as string),
    fxRateSource: json.fxRateSource as FxRateSource | null,
    note: json.note as string | null,
    warnings: [...(json.warnings as string[])],
  };
}

function toImportBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: toImportBatchId(row.id),
    accountId: toAccountId(row.accountId),
    broker: row.broker,
    blobKey: row.blobKey,
    status: row.status,
    failureReason: row.failureReason,
    totalRows: row.totalRows,
    acceptedRows: row.acceptedRows,
    rejectedRows: row.rejectedRows,
    duplicateRows: row.duplicateRows,
    warnings: row.warnings,
    uploadedAt: Temporal.Instant.fromEpochMilliseconds(row.uploadedAt.getTime()),
  };
}

function toImportRow(row: ImportRowRow): ImportRow {
  return {
    id: toImportRowId(row.id),
    batchId: toImportBatchId(row.batchId),
    rowIndex: row.rowIndex,
    parsed: deserializeParsedRow(row.parsed),
    status: row.status,
    transactionId: row.transactionId === null ? null : toTransactionId(row.transactionId),
    rejectionReason: row.rejectionReason,
    resolvedInstrumentId:
      row.resolvedInstrumentId === null ? null : toInstrumentId(row.resolvedInstrumentId),
  };
}

function scopedTo(db: Database, userId: UserId): ScopedImportRepository {
  const owned = eq(importBatches.userId, userId);

  async function requireOwnBatch(id: ImportBatchId): Promise<ImportBatchRow> {
    const [row] = await db
      .select()
      .from(importBatches)
      .where(and(owned, eq(importBatches.id, id)))
      .limit(1);
    if (row === undefined) throw new Error(`No import batch ${id}`);
    return row;
  }

  return {
    async createBatch(input: CreateImportBatchInput) {
      const [row] = await db
        .insert(importBatches)
        .values({
          userId,
          accountId: input.accountId,
          broker: input.broker,
          blobKey: input.blobKey,
        })
        .returning();
      return toImportBatch(row!);
    },

    async markBatchParsed(id, result) {
      await requireOwnBatch(id);
      const [row] = await db
        .update(importBatches)
        .set({
          status: 'parsed',
          totalRows: result.totalRows,
          warnings: [...result.warnings],
          updatedAt: new Date(),
        })
        .where(and(owned, eq(importBatches.id, id)))
        .returning();
      return toImportBatch(row!);
    },

    async markBatchFailed(id, reason) {
      await requireOwnBatch(id);
      const [row] = await db
        .update(importBatches)
        .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
        .where(and(owned, eq(importBatches.id, id)))
        .returning();
      return toImportBatch(row!);
    },

    async createRows(batchId, rows) {
      await requireOwnBatch(batchId);
      if (rows.length === 0) return [];

      const inserted = await db
        .insert(importRows)
        .values(
          rows.map((row, index) => ({
            batchId,
            rowIndex: index,
            parsed: serializeParsedRow(row),
          })),
        )
        .returning();
      return inserted.map(toImportRow);
    },

    async getBatch(id) {
      const [row] = await db
        .select()
        .from(importBatches)
        .where(and(owned, eq(importBatches.id, id)))
        .limit(1);
      return row === undefined ? null : toImportBatch(row);
    },

    async rowsForBatch(batchId) {
      await requireOwnBatch(batchId);
      const rows = await db
        .select()
        .from(importRows)
        .where(eq(importRows.batchId, batchId))
        .orderBy(importRows.rowIndex);
      return rows.map(toImportRow);
    },

    async resolveInstruments(batchId, resolutions: readonly InstrumentResolution[]) {
      await requireOwnBatch(batchId);
      if (resolutions.length === 0) return [];

      // One `UPDATE` per distinct ticker, not per row: `resolutions.length` is
      // the count of tickers being confirmed in this call — a handful, even
      // for a statement with hundreds of lines — so this stays a handful of
      // queries, not one per row.
      const updated: ImportRowRow[] = [];
      for (const resolution of resolutions) {
        const exchangeMatch =
          resolution.exchange === null
            ? sql`(${importRows.parsed}->'instrument'->>'exchange') IS NULL`
            : sql`(${importRows.parsed}->'instrument'->>'exchange') = ${resolution.exchange}`;

        const rows = await db
          .update(importRows)
          .set({ resolvedInstrumentId: resolution.instrumentId, updatedAt: new Date() })
          .where(
            and(
              eq(importRows.batchId, batchId),
              sql`(${importRows.parsed}->'instrument'->>'symbol') = ${resolution.symbol}`,
              exchangeMatch,
            ),
          )
          .returning();
        updated.push(...rows);
      }
      return updated.map(toImportRow);
    },

    async getRow(id: ImportRowId) {
      const [found] = await db
        .select({ row: importRows })
        .from(importRows)
        .innerJoin(importBatches, eq(importRows.batchId, importBatches.id))
        .where(and(eq(importRows.id, id), owned))
        .limit(1);
      return found === undefined ? null : toImportRow(found.row);
    },

    async recordRowOutcome(id: ImportRowId, outcome: ImportRowOutcome) {
      const [found] = await db
        .select({ row: importRows })
        .from(importRows)
        .innerJoin(importBatches, eq(importRows.batchId, importBatches.id))
        .where(and(eq(importRows.id, id), owned))
        .limit(1);
      if (found === undefined) throw new Error(`No import row ${id}`);

      const [updated] = await db
        .update(importRows)
        .set({
          status: outcome.status,
          transactionId: outcome.status === 'rejected' ? null : outcome.transactionId,
          rejectionReason:
            outcome.status === 'rejected' || outcome.status === 'duplicate' ? outcome.reason : null,
          updatedAt: new Date(),
        })
        .where(eq(importRows.id, id))
        .returning();
      return toImportRow(updated!);
    },

    async recordRowOutcomes(batchId: ImportBatchId, outcomes) {
      if (outcomes.length === 0) return [];

      // One `UPDATE` for the whole batch — a `CASE` per column keyed by
      // `id`, rather than `recordRowOutcome`'s one `UPDATE` per row. Each
      // `THEN` branch is cast explicitly (`::import_row_status`, `::uuid`,
      // `::text`): a `sql` fragment carries no column type of its own, so
      // Postgres would otherwise see `text` and refuse the enum/uuid columns.
      // `batch_id` in the `WHERE` is the ownership check — cheap because
      // `batchId` is already proven owned by this call's own `getBatch`, so
      // this skips `recordRowOutcome`'s per-row join against `import_batches`.
      const statusCase = sql.join(
        outcomes.map(
          ({ id, outcome }) => sql`WHEN ${id}::uuid THEN ${outcome.status}::import_row_status`,
        ),
        sql` `,
      );
      const transactionIdCase = sql.join(
        outcomes.map(({ id, outcome }) => {
          const transactionId = outcome.status === 'rejected' ? null : outcome.transactionId;
          return sql`WHEN ${id}::uuid THEN ${transactionId}::uuid`;
        }),
        sql` `,
      );
      const rejectionReasonCase = sql.join(
        outcomes.map(({ id, outcome }) => {
          const reason =
            outcome.status === 'rejected' || outcome.status === 'duplicate' ? outcome.reason : null;
          return sql`WHEN ${id}::uuid THEN ${reason}::text`;
        }),
        sql` `,
      );
      const ids = outcomes.map(({ id }) => id);

      await db
        .update(importRows)
        .set({
          status: sql`CASE ${importRows.id} ${statusCase} END`,
          transactionId: sql`CASE ${importRows.id} ${transactionIdCase} END`,
          rejectionReason: sql`CASE ${importRows.id} ${rejectionReasonCase} END`,
          updatedAt: new Date(),
        })
        .where(and(eq(importRows.batchId, batchId), inArray(importRows.id, ids)));

      const updated = await db
        .select()
        .from(importRows)
        .where(and(eq(importRows.batchId, batchId), inArray(importRows.id, ids)));
      return updated.map(toImportRow);
    },
  };
}

export function importRepository(db: Database): ImportRepository {
  return { forUser: (userId: UserId) => scopedTo(db, userId) };
}
