import { type UserId } from '../ports/session';
import { Temporal } from '../time';

import {
  type CreateImportBatchInput,
  type ImportRepository,
  type InstrumentResolution,
  type ScopedImportRepository,
} from './ports';
import {
  importBatchId,
  importRowId,
  type ImportBatch,
  type ImportBatchId,
  type ImportRow,
} from './types';

/**
 * One table, one scoping predicate — same shape and same rationale as
 * `InMemoryLedger` (`../ledger/in-memory-ledger.ts`): `forUser(userId)` is the
 * only way to reach a row, so a fake that captures the user once and filters
 * every read on it is exactly the thing under test (ADR 0009).
 *
 * A test double, not production code — `./index` and the package root never
 * re-export it.
 */
export class InMemoryImports implements ImportRepository {
  private readonly batchRows: { owner: UserId; batch: ImportBatch }[] = [];
  private readonly rowRows: ImportRow[] = [];
  private sequence = 0;

  private nextId(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
  }

  /** Monotonic but not wall-clock — fine for a fake, and keeps tests deterministic. */
  private nextUploadedAt(): Temporal.Instant {
    this.sequence += 1;
    return Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000 + this.sequence);
  }

  /** Every batch ever created, regardless of owner — test introspection only, mirrors `InMemoryLedger.rawRowCount()`. */
  allBatches(): readonly ImportBatch[] {
    return this.batchRows.map((row) => row.batch);
  }

  /** Every row created for a batch, in insertion order — test introspection only. */
  rowsFor(batchId: ImportBatchId): readonly ImportRow[] {
    return this.rowRows.filter((row) => row.batchId === batchId);
  }

  forUser(user: UserId): ScopedImportRepository {
    const ownedBatch = (id: ImportBatchId) =>
      this.batchRows.find((row) => row.owner === user && row.batch.id === id);

    return {
      createBatch: (input: CreateImportBatchInput) => {
        const batch: ImportBatch = {
          id: importBatchId(this.nextId()),
          accountId: input.accountId,
          broker: input.broker,
          blobKey: input.blobKey,
          status: 'pending',
          failureReason: null,
          totalRows: 0,
          acceptedRows: 0,
          rejectedRows: 0,
          duplicateRows: 0,
          warnings: [],
          uploadedAt: this.nextUploadedAt(),
        };
        this.batchRows.push({ owner: user, batch });
        return Promise.resolve(batch);
      },

      markBatchParsed: (id, result) => {
        const found = ownedBatch(id);
        if (found === undefined) return Promise.reject(new Error(`No import batch ${id}`));
        found.batch = {
          ...found.batch,
          status: 'parsed',
          totalRows: result.totalRows,
          warnings: [...result.warnings],
        };
        return Promise.resolve(found.batch);
      },

      markBatchFailed: (id, reason) => {
        const found = ownedBatch(id);
        if (found === undefined) return Promise.reject(new Error(`No import batch ${id}`));
        found.batch = { ...found.batch, status: 'failed', failureReason: reason };
        return Promise.resolve(found.batch);
      },

      createRows: (batchId, rows) => {
        const found = ownedBatch(batchId);
        if (found === undefined) return Promise.reject(new Error(`No import batch ${batchId}`));
        if (rows.length === 0) return Promise.resolve([]);

        const created = rows.map((parsed, index) => {
          const row: ImportRow = {
            id: importRowId(this.nextId()),
            batchId,
            rowIndex: index,
            parsed,
            status: 'pending',
            transactionId: null,
            rejectionReason: null,
            resolvedInstrumentId: null,
          };
          this.rowRows.push(row);
          return row;
        });
        return Promise.resolve(created);
      },

      getBatch: (id) => Promise.resolve(ownedBatch(id)?.batch ?? null),

      rowsForBatch: (batchId) => {
        const found = ownedBatch(batchId);
        if (found === undefined) return Promise.reject(new Error(`No import batch ${batchId}`));
        return Promise.resolve(
          this.rowRows
            .filter((row) => row.batchId === batchId)
            .sort((left, right) => left.rowIndex - right.rowIndex),
        );
      },

      resolveInstruments: (batchId, resolutions: readonly InstrumentResolution[]) => {
        const found = ownedBatch(batchId);
        if (found === undefined) return Promise.reject(new Error(`No import batch ${batchId}`));
        if (resolutions.length === 0) return Promise.resolve([]);

        const touched: ImportRow[] = [];
        for (const resolution of resolutions) {
          this.rowRows.forEach((row, index) => {
            if (row.batchId !== batchId) return;
            const candidate = row.parsed.instrument;
            if (candidate === null) return;
            if (candidate.symbol !== resolution.symbol) return;
            if (candidate.exchange !== resolution.exchange) return;

            const updated: ImportRow = {
              ...row,
              resolvedInstrumentId: resolution.instrumentId,
            };
            this.rowRows[index] = updated;
            touched.push(updated);
          });
        }
        return Promise.resolve(touched);
      },
    };
  }
}
