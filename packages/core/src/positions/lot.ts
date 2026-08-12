import type Decimal from 'decimal.js';

import { type AccountId, type InstrumentId, type TransactionId } from '../ledger';
import { type Money } from '../money';
import { Temporal } from '../time';

/**
 * **A lot's id is the id of the buy that opened it.**
 *
 * Lots are derived from the ledger and never stored (ADR 0003), so they are
 * rebuilt from scratch on every read. That makes identity a real design
 * question rather than a detail: `matched_lot_ids` on a sell row records which
 * lots a sale consumed, and it can only still mean something after the next
 * rebuild if lot identity comes from something durable. The opening
 * transaction is the only such thing — a synthetic or position-based id would
 * silently re-point the moment an earlier transaction is edited or deleted.
 */
export type LotId = TransactionId;

export interface Lot {
  readonly id: LotId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly openedOn: Temporal.PlainDate;
  readonly originalQuantity: Decimal;
  readonly remainingQuantity: Decimal;
  /** Cost basis of the whole original purchase, in the **account** currency. */
  readonly originalCost: Money;
  /**
   * Basis still attributable to what is left. Carried by subtraction rather
   * than recomputed from a ratio, so that consuming a lot completely returns
   * it to exactly zero instead of a recurring-decimal residue.
   */
  readonly remainingCost: Money;
}

export function isOpen(lot: Lot): boolean {
  return lot.remainingQuantity.greaterThan(0);
}
