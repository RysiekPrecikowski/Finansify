import Decimal from 'decimal.js';

import {
  costBasisOf,
  netProceedsOf,
  type Account,
  type AccountId,
  type InstrumentId,
  type Transaction,
  type TransactionType,
} from '../ledger';
import { Money, type Currency } from '../money';
import { type Lot } from './lot';
import { defaultLotStrategy, matchLots, type LotStrategy } from './lot-selection';

export class UnsupportedTransactionTypeError extends Error {
  constructor(type: TransactionType) {
    super(
      `Transaction type "${type}" does not have position accounting yet — refusing to compute a basis rather than compute a wrong one`,
    );
    this.name = 'UnsupportedTransactionTypeError';
  }
}

export class MixedCurrencyPositionError extends Error {
  constructor(queueCurrency: Currency, transactionCurrency: Currency) {
    super(
      `A position already holding lots in ${queueCurrency} received a transaction in ${transactionCurrency}; the position engine performs no currency conversion, so a lot queue cannot mix currencies (ADR 0021)`,
    );
    this.name = 'MixedCurrencyPositionError';
  }
}

export class UnknownAccountError extends Error {
  constructor(accountId: AccountId) {
    super(`No account ${accountId} was supplied for its transactions`);
    this.name = 'UnknownAccountError';
  }
}

/**
 * Types that add units to a position. Exported so `valuation/value-series.ts`
 * can classify the same ledger without a second copy of this table — the
 * risk rule 13 exists for.
 */
export const openingTypes = new Set<TransactionType>(['buy', 'transfer_in', 'bond_purchase']);

/** Types that remove them. */
export const closingTypes = new Set<TransactionType>([
  'sell',
  'transfer_out',
  'bond_redemption',
  'bond_early_redemption',
]);

export interface Position {
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  /**
   * The currency the position's lots actually settled in — fixed by the
   * first chronological transaction on this `(account, instrument)` queue,
   * not the account's currency (ADR 0021).
   */
  readonly currency: Currency;
  readonly quantity: Decimal;
  readonly costBasis: Money;
  readonly realized: Money;
  /** Open lots only, oldest first. */
  readonly lots: readonly Lot[];
}

/**
 * Exported for `valuation/value-series.ts`, which walks the same ledger in the
 * same order to fold quantities day by day — the ordering FIFO depends on and
 * the ordering the series walk depends on must be the one comparator, not two
 * that happen to agree today.
 */
export function chronologically(left: Transaction, right: Transaction): number {
  if (!left.tradeDate.equals(right.tradeDate)) {
    return left.tradeDate.since(right.tradeDate).sign;
  }
  // Same-day trades need a stable tiebreak, or FIFO depends on whatever order
  // the database happened to return and stops being reproducible.
  return left.id.localeCompare(right.id);
}

function keyOf(accountId: AccountId, instrumentId: InstrumentId): string {
  return `${accountId}::${instrumentId}`;
}

/**
 * Folds the ledger into lots per `(account, instrument)`.
 *
 * `split` throws rather than being ignored or guessed at: a split silently
 * mis-applied corrupts cost basis retroactively and nothing downstream would
 * flag it. The type stays in the schema so Phase 4 can import one; the engine
 * refuses it until the ratio handling is actually written.
 *
 * Everything with no unit effect — dividends, fees, deposits — is skipped here
 * and handled by `buildCashBalances`.
 */
export function buildPositions(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  strategy: LotStrategy = defaultLotStrategy,
): readonly Position[] {
  const knownAccountIds = new Set<AccountId>(accounts.map((account) => account.id));
  const lotsByKey = new Map<string, Lot[]>();
  const realizedByKey = new Map<string, Money>();
  const queueCurrencyByKey = new Map<string, Currency>();
  const order: string[] = [];

  for (const transaction of [...transactions].sort(chronologically)) {
    if (transaction.type === 'split') throw new UnsupportedTransactionTypeError(transaction.type);

    const opens = openingTypes.has(transaction.type);
    const closes = closingTypes.has(transaction.type);
    if (!opens && !closes) continue;
    if (transaction.instrumentId === null) continue;

    if (!knownAccountIds.has(transaction.accountId)) {
      throw new UnknownAccountError(transaction.accountId);
    }

    const key = keyOf(transaction.accountId, transaction.instrumentId);
    if (!queueCurrencyByKey.has(key)) {
      // The first chronologically processed transaction on this queue fixes
      // its currency (ADR 0021) — every later transaction, opening or
      // closing, must match it.
      lotsByKey.set(key, []);
      realizedByKey.set(key, Money.zero(transaction.currency));
      queueCurrencyByKey.set(key, transaction.currency);
      order.push(key);
    }
    const queueCurrency = queueCurrencyByKey.get(key)!;
    if (transaction.currency !== queueCurrency) {
      throw new MixedCurrencyPositionError(queueCurrency, transaction.currency);
    }
    const lots = lotsByKey.get(key)!;

    if (opens) {
      lots.push({
        id: transaction.id,
        accountId: transaction.accountId,
        instrumentId: transaction.instrumentId,
        openedOn: transaction.tradeDate,
        originalQuantity: transaction.quantity,
        remainingQuantity: transaction.quantity,
        originalCost: costBasisOf(transaction),
        remainingCost: costBasisOf(transaction),
      });
      continue;
    }

    const match = matchLots(
      lots,
      transaction.quantity,
      strategy,
      transaction.matchedLotIds ?? null,
    );
    // A per-sale override is honoured by passing `matched_lot_ids` straight
    // through, which is what keeps specific-lot selection from making the
    // engine stateful.
    const proceeds = netProceedsOf(transaction);

    lotsByKey.set(key, [...match.lots]);
    realizedByKey.set(key, realizedByKey.get(key)!.plus(proceeds).minus(match.costOfSale));
  }

  return order.map((key) => {
    const lots = lotsByKey.get(key)!.filter((lot) => lot.remainingQuantity.greaterThan(0));
    const [accountId, instrumentId] = key.split('::') as [AccountId, InstrumentId];
    const realized = realizedByKey.get(key)!;

    return {
      accountId,
      instrumentId,
      currency: realized.currency,
      quantity: lots.reduce((total, lot) => total.plus(lot.remainingQuantity), new Decimal(0)),
      costBasis: lots.reduce(
        (total, lot) => total.plus(lot.remainingCost),
        Money.zero(realized.currency),
      ),
      realized,
      lots,
    };
  });
}

/**
 * Weighted average cost per unit, or `null` for a fully closed position —
 * dividing by zero units would produce a number that looks like a price.
 */
export function averageCostOf(position: Position): Decimal | null {
  if (position.quantity.isZero()) return null;
  return position.costBasis.amount.dividedBy(position.quantity);
}
