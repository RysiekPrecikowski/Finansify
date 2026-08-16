import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { accountId, instrumentId, transactionId } from '../ledger/types';
import { currency as toCurrency, Money } from '../money';
import { type Lot } from '../positions/lot';
import { Temporal } from '../time';
import { resolveFamilyRules } from './families';
import { parseSeriesCode } from './series-code';
import { type BondTerms } from './types';
import { FractionalBondError, valueBondPosition } from './value-bond-position';

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
