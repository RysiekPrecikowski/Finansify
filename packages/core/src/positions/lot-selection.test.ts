import Decimal from 'decimal.js';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type AccountId, type InstrumentId } from '../ledger';
import { Money, currency } from '../money';
import { Temporal } from '../time';
import { isOpen, type Lot, type LotId } from './lot';
import {
  InsufficientLotsError,
  UnknownLotError,
  lotStrategies,
  matchLots,
  type LotStrategy,
} from './lot-selection';

const PLN = currency('PLN');

// Lot ids are transaction UUIDs in production; short labels keep the ordering
// assertions readable, and the tiebreak is a plain string compare either way.
function lot(
  id: string,
  openedOn: string,
  quantity: string,
  cost: string,
  remaining?: { quantity: string; cost: string },
): Lot {
  return {
    id: id as LotId,
    accountId: 'account-1' as AccountId,
    instrumentId: 'instrument-1' as InstrumentId,
    openedOn: Temporal.PlainDate.from(openedOn),
    originalQuantity: new Decimal(quantity),
    remainingQuantity: new Decimal(remaining?.quantity ?? quantity),
    originalCost: Money.of(cost, PLN),
    remainingCost: Money.of(remaining?.cost ?? cost, PLN),
  };
}

const quantitiesOf = (lots: readonly Lot[]) =>
  lots.reduce((total, item) => total.plus(item.remainingQuantity), new Decimal(0));

const basisOf = (lots: readonly Lot[]) =>
  lots.reduce((total, item) => total.plus(item.remainingCost), Money.zero(PLN));

/** The order `fifo` is specified to use, restated here so the two can be compared. */
const oldestFirst = (lots: readonly Lot[]): readonly LotId[] =>
  [...lots]
    .filter(isOpen)
    .sort(
      (left, right) =>
        Temporal.PlainDate.compare(left.openedOn, right.openedOn) ||
        left.id.localeCompare(right.id),
    )
    .map((item) => item.id);

describe('matchLots', () => {
  it('consumes the oldest lot first under fifo, whatever order the lots arrive in', () => {
    const lots = [
      lot('newer', '2024-03-01', '10', '1000'),
      lot('older', '2024-01-01', '10', '800'),
    ];

    const match = matchLots(lots, new Decimal('12'), 'fifo');

    expect(match.consumed.map((item) => item.lotId)).toEqual(['older', 'newer']);
    expect(match.consumed[0]!.cost.equals(Money.of('800', PLN))).toBe(true);
    expect(match.consumed[1]!.quantity.equals(2)).toBe(true);
    expect(match.consumed[1]!.cost.equals(Money.of('200', PLN))).toBe(true);
    expect(match.costOfSale.equals(Money.of('1000', PLN))).toBe(true);
  });

  it('consumes the newest lot first under lifo', () => {
    const lots = [
      lot('older', '2024-01-01', '10', '800'),
      lot('newer', '2024-03-01', '10', '1000'),
    ];

    const match = matchLots(lots, new Decimal('12'), 'lifo');

    expect(match.consumed.map((item) => item.lotId)).toEqual(['newer', 'older']);
    expect(match.consumed[0]!.cost.equals(Money.of('1000', PLN))).toBe(true);
    expect(match.consumed[1]!.cost.equals(Money.of('160', PLN))).toBe(true);
  });

  it('consumes exactly the lots named by a specific selection, in the order named', () => {
    const lots = [
      lot('a', '2024-01-01', '10', '100'),
      lot('b', '2024-02-01', '10', '200'),
      lot('c', '2024-03-01', '10', '300'),
    ];

    const match = matchLots(lots, new Decimal('15'), 'specific', ['c' as LotId, 'a' as LotId]);

    expect(match.consumed.map((item) => item.lotId)).toEqual(['c', 'a']);
    expect(match.consumed[1]!.quantity.equals(5)).toBe(true);
    expect(match.costOfSale.equals(Money.of('350', PLN))).toBe(true);
    // `b` was not named, so it must be untouched.
    expect(match.lots[1]!.remainingQuantity.equals(10)).toBe(true);
  });

  it('takes the same fraction of every lot under average', () => {
    const lots = [lot('a', '2024-01-01', '10', '1000'), lot('b', '2024-02-01', '30', '600')];

    const match = matchLots(lots, new Decimal('10'), 'average');

    // A quarter of the position is sold, so each lot gives up a quarter of itself.
    expect(match.consumed[0]!.quantity.equals('2.5')).toBe(true);
    expect(match.consumed[1]!.quantity.equals('7.5')).toBe(true);
    expect(match.consumed[0]!.cost.equals(Money.of('250', PLN))).toBe(true);
    expect(match.consumed[1]!.cost.equals(Money.of('150', PLN))).toBe(true);
    expect(match.costOfSale.equals(Money.of('400', PLN))).toBe(true);
  });

  it('refuses to sell more than is held', () => {
    const lots = [lot('a', '2024-01-01', '10', '100')];

    expect(() => matchLots(lots, new Decimal('11'), 'fifo')).toThrow(InsufficientLotsError);
  });

  it('refuses a specific selection that does not cover the sale', () => {
    const lots = [lot('a', '2024-01-01', '10', '100'), lot('b', '2024-02-01', '10', '200')];

    expect(() => matchLots(lots, new Decimal('15'), 'specific', ['a' as LotId])).toThrow(
      InsufficientLotsError,
    );
  });

  it('refuses a specific id that is not an open lot', () => {
    const lots = [
      lot('a', '2024-01-01', '10', '100'),
      lot('closed', '2024-02-01', '10', '200', { quantity: '0', cost: '0' }),
    ];

    expect(() => matchLots(lots, new Decimal('1'), 'specific', ['ghost' as LotId])).toThrow(
      UnknownLotError,
    );
    expect(() => matchLots(lots, new Decimal('1'), 'specific', ['closed' as LotId])).toThrow(
      UnknownLotError,
    );
  });

  it('refuses specific selection with nothing selected rather than falling back to fifo', () => {
    const lots = [lot('a', '2024-01-01', '10', '100')];

    expect(() => matchLots(lots, new Decimal('1'), 'specific', null)).toThrow(UnknownLotError);
    expect(() => matchLots(lots, new Decimal('1'), 'specific', [])).toThrow(UnknownLotError);
  });

  it('refuses a zero or negative sale quantity', () => {
    const lots = [lot('a', '2024-01-01', '10', '100')];

    expect(() => matchLots(lots, new Decimal('0'), 'fifo')).toThrow(RangeError);
    expect(() => matchLots(lots, new Decimal('-1'), 'fifo')).toThrow(RangeError);
  });

  it('orders same-day lots by id, so fifo does not inherit database row order', () => {
    // Both orderings of the same two lots must produce the same consumption;
    // without the id tiebreak this passes or fails on whatever the query returned.
    const forwards = [
      lot('lot-a', '2024-01-01', '10', '100'),
      lot('lot-b', '2024-01-01', '10', '200'),
    ];
    const backwards = [forwards[1]!, forwards[0]!];

    expect(matchLots(forwards, new Decimal('5'), 'fifo').consumed[0]!.lotId).toBe('lot-a');
    expect(matchLots(backwards, new Decimal('5'), 'fifo').consumed[0]!.lotId).toBe('lot-a');
    expect(matchLots(forwards, new Decimal('5'), 'lifo').consumed[0]!.lotId).toBe('lot-b');
    expect(matchLots(backwards, new Decimal('5'), 'lifo').consumed[0]!.lotId).toBe('lot-b');
  });
});

// Quantities deliberately include thirds and sevenths of a unit: a per-unit cost
// derived from them never terminates, which is exactly where a ratio-based
// remainder would leave a residue behind.
const quantityArb = fc
  .tuple(fc.integer({ min: 1, max: 5000 }), fc.constantFrom('', '.3', '.7', '.125', '.000001'))
  .map(([whole, fraction]) => `${String(whole)}${fraction}`);

const costArb = fc
  .tuple(fc.integer({ min: 1, max: 1_000_000 }), fc.constantFrom('00', '01', '33', '99'))
  .map(([whole, grosze]) => `${String(whole)}.${grosze}`);

// A five-day window guarantees same-day lots turn up, so the id tiebreak is
// exercised by the properties as well as by the unit case above.
const lotsArb = fc
  .array(fc.tuple(quantityArb, costArb, fc.integer({ min: 1, max: 5 })), {
    minLength: 1,
    maxLength: 6,
  })
  .map((specs) =>
    specs.map(([quantity, cost, day], index) =>
      lot(`lot-${String(index)}`, `2024-01-0${String(day)}`, quantity, cost),
    ),
  );

const strategyArb = fc.constantFrom<LotStrategy>(...lotStrategies);

/** A percentage of the position, so partial sales land on non-terminating quantities too. */
const percentArb = fc.integer({ min: 1, max: 99 });

describe('matchLots invariants (docs/roadmap.md, Phase 1)', () => {
  it('returns cost basis to exactly zero when the whole position is sold', () => {
    fc.assert(
      fc.property(lotsArb, strategyArb, percentArb, (lots, strategy, percent) => {
        const total = quantitiesOf(lots);
        const firstSale = total.times(percent).dividedBy(100);

        // Sell part, then the rest: a residue left by the partial sale has
        // nowhere to hide once the position closes.
        const afterFirst = matchLots(
          lots,
          firstSale,
          strategy,
          strategy === 'specific' ? oldestFirst(lots) : null,
        );
        const left = quantitiesOf(afterFirst.lots);
        const afterAll = left.greaterThan(0)
          ? matchLots(
              afterFirst.lots,
              left,
              strategy,
              strategy === 'specific' ? oldestFirst(afterFirst.lots) : null,
            )
          : afterFirst;

        expect(quantitiesOf(afterAll.lots).isZero()).toBe(true);
        // Exactly zero, not near it: `toBeCloseTo` would pass on the residue
        // this invariant exists to forbid.
        expect(basisOf(afterAll.lots).equals(Money.zero(PLN))).toBe(true);

        // The mechanism behind it: the closing consumption releases the basis
        // that is actually left, so no lot can end up holding a fragment.
        for (const item of afterAll.lots) {
          expect(item.remainingCost.isZero()).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('agrees between fifo and a specific selection listed oldest first', () => {
    fc.assert(
      fc.property(lotsArb, fc.integer({ min: 1, max: 100 }), (lots, percent) => {
        const quantity = quantitiesOf(lots).times(percent).dividedBy(100);

        const viaFifo = matchLots(lots, quantity, 'fifo');
        const viaSpecific = matchLots(lots, quantity, 'specific', oldestFirst(lots));

        expect(viaSpecific.consumed.map((item) => item.lotId)).toEqual(
          viaFifo.consumed.map((item) => item.lotId),
        );
        expect(viaSpecific.consumed.map((item) => item.quantity.toFixed())).toEqual(
          viaFifo.consumed.map((item) => item.quantity.toFixed()),
        );
        expect(viaSpecific.costOfSale.equals(viaFifo.costOfSale)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

/**
 * Regression for a counterexample `fast-check` produced against `decimal.js`'s
 * 20-significant-digit default, which is fewer digits than the `NUMERIC(28, 10)`
 * the row is stored in. Pro-rating a partially sold lot rounded in memory to a
 * precision the database would have kept, and released basis stopped summing to
 * the original. `money.ts` now raises the precision to 40; this pins it.
 */
describe('total basis conservation', () => {
  it('releases exactly the original basis across a partial sale and the remainder', () => {
    const lots = [
      lot('l1', '2026-01-01', '1330.125', '699191.33'),
      lot('l2', '2026-01-02', '1318.125', '1'),
    ];
    const original = lots.reduce((total, item) => total.plus(item.remainingCost), Money.zero(PLN));
    const held = lots.reduce((total, item) => total.plus(item.remainingQuantity), new Decimal(0));
    const slice = held.times('0.04');

    const first = matchLots(lots, slice, 'fifo');
    const second = matchLots(first.lots, held.minus(slice), 'fifo');

    expect(first.costOfSale.plus(second.costOfSale).equals(original)).toBe(true);
    expect(second.lots.every((item) => item.remainingCost.isZero())).toBe(true);
  });
});
