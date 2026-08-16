import {
  accountId as toAccountId,
  currency as toCurrency,
  importBatchId as toImportBatchId,
  importRowId as toImportRowId,
  Money,
  Temporal,
  transactionId as toTransactionId,
  type CreateImportBatchInput,
  type FxRateSource,
  type ImportBatch,
  type ImportBatchId,
  type ImportRepository,
  type ImportRow,
  type ParsedInstrumentCandidate,
  type ParsedRow,
  type ScopedImportRepository,
  type TransactionType,
  type UserId,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';

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
  };
}

export function importRepository(db: Database): ImportRepository {
  return { forUser: (userId: UserId) => scopedTo(db, userId) };
}
