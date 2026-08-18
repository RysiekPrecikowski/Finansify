import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { MissingIndexObservationError } from './accrue-bond';
import { accountId, instrumentId, transactionId } from '../ledger/types';
import { currency as toCurrency, Money } from '../money';
import { type Lot } from '../positions/lot';
import { Temporal } from '../time';
import { resolveFamilyRules } from './families';
import { parseSeriesCode } from './series-code';
import { type BondTerms } from './types';
import { type BondInterestTable, type PurchaseDayKey } from './interest-table';
import {
  FractionalBondError,
  valueBondPosition,
  type PublishedTables,
} from './value-bond-position';
import publishedFixture from './__fixtures__/pekao-tables.json';

const PLN = toCurrency('PLN');
const date = (iso: string) => Temporal.PlainDate.from(iso);
const pln = (amount: string) => Money.of(amount, PLN);

const ACCOUNT = accountId('11111111-1111-4111-8111-111111111111');
const INSTRUMENT = instrumentId('22222222-2222-4222-8222-222222222222');

function terms(code: string, settledOn: string, rate: string, margin = '0'): BondTerms {
  const parsed = parseSeriesCode(code);
  return {
    seriesCode: parsed.code,
    rules: resolveFamilyRules(parsed.family, date(settledOn)),
    firstPeriodRate: new Decimal(rate),
    margin: new Decimal(margin),
  };
}

function lot(id: string, openedOn: string, quantity: string, remaining = quantity): Lot {
  return {
    id: transactionId(id),
    accountId: ACCOUNT,
    instrumentId: INSTRUMENT,
    openedOn: date(openedOn),
    originalQuantity: new Decimal(quantity),
    remainingQuantity: new Decimal(remaining),
    originalCost: pln((Number(quantity) * 100).toFixed(2)),
    remainingCost: pln((Number(remaining) * 100).toFixed(2)),
  };
}

/** Every lot in these fixtures shares one purchase era, so one `BondTerms` fits all. */
const withTerms = (terms: BondTerms, lots: readonly Lot[]) => lots.map((lot) => ({ lot, terms }));

const LOT_A = '33333333-3333-4333-8333-333333333331';
const LOT_B = '33333333-3333-4333-8333-333333333332';

describe('valueBondPosition', () => {
  it('accrues each lot from its own settlement date, not from a shared one', () => {
    // The point of the whole function. Two purchases of TOS0829 a year apart:
    // the older one has completed a 4.40% period and capitalized it, the newer
    // one has barely started. Accruing both from either date would be wrong.
    const held = [lot(LOT_A, '2026-08-01', '1'), lot(LOT_B, '2027-08-01', '1')];

    const valued = valueBondPosition(
      withTerms(terms('TOS0829', '2026-08-01', '0.044'), held),
      date('2027-08-01'),
      [],
    );

    expect(valued.lots).toHaveLength(2);
    expect(valued.lots[0]?.accruedInterest).toEqual(pln('4.40'));
    expect(valued.lots[1]?.accruedInterest).toEqual(pln('0.00'));
    // 104.40 + 100.00
    expect(valued.marketValue).toEqual(pln('204.40'));
  });

  it('sums a single lot to exactly what accrueBond gives it', () => {
    const valued = valueBondPosition(
      withTerms(terms('EDO0836', '2026-08-01', '0.0535', '0.02'), [lot(LOT_A, '2026-08-01', '10')]),
      date('2027-08-01'),
      [],
    );

    expect(valued.marketValue).toEqual(pln('1053.50'));
    expect(valued.accruedInterest).toEqual(pln('53.50'));
    // 10 bonds × 3.00 zł fee, and accrued interest exceeds it.
    expect(valued.earlyRedemptionValue).toEqual(pln('1023.50'));
  });

  it('values what is left of a partly redeemed lot, not what it started as', () => {
    const partly = lot(LOT_A, '2026-08-01', '10', '4');

    const valued = valueBondPosition(
      withTerms(terms('EDO0836', '2026-08-01', '0.0535', '0.02'), [partly]),
      date('2027-08-01'),
      [],
    );

    expect(valued.marketValue).toEqual(pln('421.40'));
  });

  it('skips a fully consumed lot rather than reporting a zero row', () => {
    const valued = valueBondPosition(
      withTerms(terms('EDO0836', '2026-08-01', '0.0535', '0.02'), [
        lot(LOT_A, '2026-08-01', '10', '0'),
        lot(LOT_B, '2026-08-01', '2'),
      ]),
      date('2027-08-01'),
      [],
    );

    expect(valued.lots).toHaveLength(1);
    expect(valued.marketValue).toEqual(pln('210.70'));
  });

  it('carries paid interest through for the families that pay out', () => {
    const valued = valueBondPosition(
      withTerms(terms('COI0830', '2026-08-01', '0.0475', '0.015'), [lot(LOT_A, '2026-08-01', '3')]),
      date('2028-08-01'),
      [{ indexId: 'pl_cpi_yoy', effectiveFrom: date('2027-07-01'), value: new Decimal('0.025') }],
    );

    // Year one paid out 4.75 per bond; year two accrues 4.00 per bond on 100.
    expect(valued.paidInterest).toEqual(pln('14.25'));
    expect(valued.accruedInterest).toEqual(pln('12.00'));
  });

  it('returns zeroes for a position with no open lots', () => {
    const valued = valueBondPosition(
      withTerms(terms('ROR0827', '2026-08-31', '0.04'), []),
      date('2026-09-30'),
      [],
    );

    expect(valued.marketValue).toEqual(pln('0'));
    expect(valued.lots).toEqual([]);
  });

  it('refuses a fractional holding rather than rounding it away', () => {
    // Nothing in the ledger stops 2.5 being typed; silently flooring it would
    // under-report the position for as long as it is held.
    expect(() =>
      valueBondPosition(
        withTerms(terms('ROR0827', '2026-08-31', '0.04'), [lot(LOT_A, '2026-08-31', '2.5')]),
        date('2026-09-30'),
        [],
      ),
    ).toThrow(FractionalBondError);
  });
});

describe('lots bought either side of a rules change', () => {
  // The early-redemption fee moved on 2024-09-01. Two EDO lots of the same
  // series across that date genuinely face different fees, so each lot has to
  // carry the terms in force for *its own* purchase — one shared `BondTerms`
  // silently applies the earlier lot's fee to both.
  it('charges each lot the fee in force when it was bought', () => {
    const older = lot(LOT_A, '2024-08-31', '1');
    const newer = lot(LOT_B, '2024-09-01', '1');

    const valued = valueBondPosition(
      [
        { lot: older, terms: terms('EDO0836', '2024-08-31', '0.0535', '0.02') },
        { lot: newer, terms: terms('EDO0836', '2024-09-01', '0.0535', '0.02') },
      ],
      date('2025-08-31'),
      [],
    );

    // A year in, each bond has accrued well past both fees, so both are
    // charged in full: 2.00 on the older lot and 3.00 on the newer one.
    const gross = valued.marketValue;
    expect(gross.minus(valued.earlyRedemptionValue)).toEqual(pln('5.00'));
  });

  it('would understate the fee if one lot’s terms were used for both', () => {
    // The bug this shape prevents, stated as a test: both lots on the older
    // terms charge 2.00 each, which is 1.00 short of what is actually due.
    const older = lot(LOT_A, '2024-08-31', '1');
    const newer = lot(LOT_B, '2024-09-01', '1');
    const sharedOldTerms = terms('EDO0836', '2024-08-31', '0.0535', '0.02');

    const wrong = valueBondPosition(
      [
        { lot: older, terms: sharedOldTerms },
        { lot: newer, terms: sharedOldTerms },
      ],
      date('2025-08-31'),
      [],
    );

    expect(wrong.marketValue.minus(wrong.earlyRedemptionValue)).toEqual(pln('4.00'));
  });
});

/**
 * The published tables enter here as a lookup, not as a fetch: `valueBondPosition`
 * is handed whatever the agent published for a purchase day and prefers it to
 * the engine, per lot. What these pin is the *precedence* and the honesty of the
 * `source` label — the arithmetic itself is `value-from-tables.test.ts`'s job.
 */
describe('valuing from the published tables', () => {
  const asFraction = (percent: string) =>
    new Decimal(percent.replace('%', '').replace(',', '.').trim()).dividedBy(100);

  const tableFrom = (entry: (typeof publishedFixture)[number]): BondInterestTable => ({
    seriesCode: parseSeriesCode(entry.series).code,
    periodOrdinal: entry.periodOrdinal,
    purchaseDayKey: entry.purchaseDayKey as PurchaseDayKey,
    startsOn: date(entry.startsOn),
    endsOn: date(entry.endsOn),
    annualRate: asFraction(entry.annualRatePercent),
    source: 'pekao',
    dailyValues: entry.dailyValues.map((value) => pln(value)),
  });

  /** Everything the agent publishes for one series, indexed the way the caller hands it over. */
  const publishedFor = (series: string): PublishedTables => {
    const byDay = new Map<number, Map<number, BondInterestTable>>();
    for (const entry of publishedFixture) {
      if (entry.series !== series) continue;
      const forDay = byDay.get(entry.purchaseDayKey) ?? new Map<number, BondInterestTable>();
      forDay.set(entry.periodOrdinal, tableFrom(entry));
      byDay.set(entry.purchaseDayKey, forDay);
    }
    return (purchaseDayKey) => byDay.get(purchaseDayKey) ?? new Map();
  };

  /** ROR0726 bought on the 1st: every period of its life is published. */
  const rorTerms = terms('ROR0726', '2025-07-01', '0.0525');

  it('answers from the engine, exactly as before, when nothing is published', () => {
    // The default argument is what every existing caller relies on, so it has
    // to leave the figures and the label untouched.
    const held = withTerms(terms('TOS0829', '2026-08-01', '0.044'), [
      lot(LOT_A, '2026-08-01', '1'),
    ]);

    const valued = valueBondPosition(held, date('2027-08-01'), []);

    expect(valued.marketValue).toEqual(pln('104.40'));
    expect(valued.source).toBe('computed');
    expect(valued.lots[0]?.source).toBe('computed');
  });

  it('prefers the agent’s figures over its own for a lot they cover', () => {
    const held = withTerms(rorTerms, [lot(LOT_A, '2025-07-01', '2')]);

    const valued = valueBondPosition(held, date('2025-09-15'), [], publishedFor('ROR0726'));

    expect(valued.source).toBe('pekao');
    expect(valued.marketValue).toEqual(pln('200.38'));
    expect(valued.accruedInterest).toEqual(pln('0.38'));
    // Two closed monthly periods, paid out as ROR does: 0,44 and 0,42 a bond.
    expect(valued.paidInterest).toEqual(pln('1.72'));
    expect(valued.earlyRedemptionValue).toEqual(pln('199.38'));
  });

  it('needs no index history at all for a lot the tables cover', () => {
    // The sharpest available proof that the figures above really came from the
    // tables: the engine cannot answer this holding without the NBP prints
    // that governed periods two and three, and refuses rather than guessing.
    const held = withTerms(rorTerms, [lot(LOT_A, '2025-07-01', '2')]);

    expect(() => valueBondPosition(held, date('2025-09-15'), [])).toThrow(
      MissingIndexObservationError,
    );
    expect(() =>
      valueBondPosition(held, date('2025-09-15'), [], publishedFor('ROR0726')),
    ).not.toThrow();
  });

  it('values a half-covered position from both paths and still calls it computed', () => {
    // The case the field exists for. The 1 July lot reads the agent's tables;
    // the 31 August lot has none published for its purchase day and falls back
    // to the engine. Both figures are right — but naming the agent on a total
    // that is partly ours would put an official-looking label on our own
    // arithmetic, which is the one thing `source` is there to prevent.
    const held = withTerms(rorTerms, [
      lot(LOT_A, '2025-07-01', '2'),
      lot(LOT_B, '2025-08-31', '2'),
    ]);

    const valued = valueBondPosition(held, date('2025-09-15'), [], publishedFor('ROR0726'));

    expect(valued.lots.map((accrual) => accrual.source)).toEqual(['pekao', 'computed']);
    expect(valued.source).toBe('computed');
    // 200.38 from the tables, 200.44 from the engine — each lot on its own
    // schedule, neither one dragged onto the other's.
    expect(valued.lots[0]?.currentValue).toEqual(pln('200.38'));
    expect(valued.lots[1]?.currentValue).toEqual(pln('200.44'));
    expect(valued.marketValue).toEqual(pln('400.82'));
    expect(valued.accruedInterest).toEqual(pln('0.82'));
    expect(valued.paidInterest).toEqual(pln('1.72'));
  });

  it('asks for the table published for each lot’s own purchase day', () => {
    // Only the month ends get their own tables, because only they have a
    // shortened period. A lot settled mid-month reads the day-1 table, and one
    // settled on the 31st must not — that is a different span entirely.
    const asked: PurchaseDayKey[] = [];
    const recording: PublishedTables = (purchaseDayKey) => {
      asked.push(purchaseDayKey);
      return new Map();
    };

    valueBondPosition(
      withTerms(terms('TOS0829', '2026-07-17', '0.044'), [
        lot(LOT_A, '2026-07-17', '1'),
        lot(LOT_B, '2026-07-31', '1'),
      ]),
      date('2026-08-17'),
      [],
      recording,
    );

    expect(asked).toEqual([1, 31]);
  });
});
