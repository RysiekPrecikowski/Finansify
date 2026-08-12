import Decimal from 'decimal.js';

import { Money } from '../money';
import { isOpen, type Lot, type LotId } from './lot';

/**
 * FIFO is the default because Polish tax treatment is effectively FIFO per
 * instrument (`docs/domain.md`). The others exist because a per-instrument
 * default is a user setting and a per-sale override is written to
 * `matched_lot_ids`, which keeps the engine stateless either way.
 */
export const lotStrategies = ['fifo', 'lifo', 'average', 'specific'] as const;
export type LotStrategy = (typeof lotStrategies)[number];

export const defaultLotStrategy: LotStrategy = 'fifo';

export class InsufficientLotsError extends Error {
  constructor(requested: Decimal, available: Decimal) {
    super(`Cannot sell ${requested.toFixed()} units — only ${available.toFixed()} are held`);
    this.name = 'InsufficientLotsError';
  }
}

export class UnknownLotError extends Error {
  constructor(lotId: LotId) {
    super(`Lot ${lotId} is not an open lot of this position`);
    this.name = 'UnknownLotError';
  }
}

export interface LotConsumption {
  readonly lotId: LotId;
  readonly quantity: Decimal;
  /** The basis that leaves the position with this quantity. */
  readonly cost: Money;
}

export interface LotMatch {
  readonly consumed: readonly LotConsumption[];
  /** Every lot after the sale, in the order given, with remainders updated. */
  readonly lots: readonly Lot[];
  /** Total basis released by the sale — the number realized P&L subtracts. */
  readonly costOfSale: Money;
}

function byOpenedThenId(left: Lot, right: Lot): number {
  const byDate = Temporal_compare(left, right);
  return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
}

// Same-day trades need a tiebreak or the order is whatever the database felt
// like returning, and FIFO stops being reproducible.
function Temporal_compare(left: Lot, right: Lot): number {
  if (left.openedOn.equals(right.openedOn)) return 0;
  return left.openedOn.since(right.openedOn).sign;
}

function sequentialOrder(
  open: readonly Lot[],
  strategy: Exclude<LotStrategy, 'average'>,
  selected: readonly LotId[] | null,
): readonly Lot[] {
  if (strategy === 'specific') {
    if (selected === null || selected.length === 0) {
      throw new UnknownLotError('' as LotId);
    }
    return selected.map((lotId) => {
      const lot = open.find((candidate) => candidate.id === lotId);
      if (lot === undefined) throw new UnknownLotError(lotId);
      return lot;
    });
  }

  const sorted = [...open].sort(byOpenedThenId);
  return strategy === 'lifo' ? sorted.reverse() : sorted;
}

/**
 * Consumes `quantity` from the open lots and reports what it cost.
 *
 * Two invariants hold whatever the strategy, and both are pinned by property
 * tests: a lot consumed in full releases **exactly** its remaining basis rather
 * than a ratio of it, and selling an entire position therefore returns its cost
 * basis to exactly zero. Recomputing a remainder from a ratio would leave a
 * recurring-decimal residue behind on every third sale.
 */
export function matchLots(
  lots: readonly Lot[],
  quantity: Decimal,
  strategy: LotStrategy = defaultLotStrategy,
  selected: readonly LotId[] | null = null,
): LotMatch {
  if (quantity.lessThanOrEqualTo(0)) {
    throw new RangeError(`A sale must have a positive quantity, got ${quantity.toFixed()}`);
  }

  const open = lots.filter(isOpen);
  const available = open.reduce((total, lot) => total.plus(lot.remainingQuantity), new Decimal(0));
  if (quantity.greaterThan(available)) throw new InsufficientLotsError(quantity, available);

  const currency = open[0]!.remainingCost.currency;
  const remaining = new Map<LotId, Lot>(lots.map((lot) => [lot.id, lot]));
  const consumed: LotConsumption[] = [];

  function take(lot: Lot, wanted: Decimal): void {
    if (wanted.lessThanOrEqualTo(0)) return;

    const current = remaining.get(lot.id)!;
    const closesLot = wanted.greaterThanOrEqualTo(current.remainingQuantity);

    // A closing consumption takes the basis that is actually left, not a ratio
    // of it — this is what makes "sell everything" land on exactly zero.
    const cost = closesLot
      ? current.remainingCost
      : current.remainingCost.times(wanted.dividedBy(current.remainingQuantity));
    const quantityTaken = closesLot ? current.remainingQuantity : wanted;

    consumed.push({ lotId: lot.id, quantity: quantityTaken, cost });
    remaining.set(lot.id, {
      ...current,
      remainingQuantity: current.remainingQuantity.minus(quantityTaken),
      remainingCost: current.remainingCost.minus(cost),
    });
  }

  if (strategy === 'average') {
    // Every lot gives up the same fraction, so the sale costs exactly
    // `quantity × weighted average` while each lot stays internally
    // consistent with its own basis.
    const fraction = quantity.dividedBy(available);
    let allocated = new Decimal(0);

    open.forEach((lot, index) => {
      const isLast = index === open.length - 1;
      // The last lot absorbs the rounding residue, so the parts sum to the
      // whole even when the fraction does not terminate.
      const share = isLast
        ? quantity.minus(allocated)
        : lot.remainingQuantity.times(fraction).toDecimalPlaces(10, Decimal.ROUND_DOWN);
      allocated = allocated.plus(share);
      take(lot, share);
    });
  } else {
    let outstanding = quantity;
    for (const lot of sequentialOrder(open, strategy, selected)) {
      if (outstanding.lessThanOrEqualTo(0)) break;
      const current = remaining.get(lot.id)!;
      const take_ = Decimal.min(outstanding, current.remainingQuantity);
      take(lot, take_);
      outstanding = outstanding.minus(take_);
    }

    if (outstanding.greaterThan(0)) {
      // Only reachable with `specific`: the chosen lots did not cover the sale.
      throw new InsufficientLotsError(quantity, quantity.minus(outstanding));
    }
  }

  return {
    consumed,
    lots: lots.map((lot) => remaining.get(lot.id)!),
    costOfSale: consumed.reduce((total, item) => total.plus(item.cost), Money.zero(currency)),
  };
}
