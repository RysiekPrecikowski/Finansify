import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency as toCurrency, Money } from '../money';
import { Temporal } from '../time';
import { resolveFamilyRules } from './families';
import { projectBondCashFlows, projectBondValue, projectEarlyRedemption } from './project-bond';
import { parseSeriesCode } from './series-code';
import { type BondPurchase, type BondTerms, type IndexObservation } from './types';

const PLN = toCurrency('PLN');
const date = (iso: string) => Temporal.PlainDate.from(iso);
const pln = (amount: string) => Money.of(amount, PLN);

function terms(code: string, settledOn: string, rate: string, margin = '0'): BondTerms {
  const parsed = parseSeriesCode(code);
  return {
    seriesCode: parsed.code,
    rules: resolveFamilyRules(parsed.family, date(settledOn)),
    firstPeriodRate: new Decimal(rate),
    margin: new Decimal(margin),
  };
}

function purchase(code: string, settledOn: string, quantity = 1): BondPurchase {
  return { seriesCode: parseSeriesCode(code).code, settledOn: date(settledOn), quantity };
}

const cpi = (on: string, value: string): IndexObservation => ({
  indexId: 'pl_cpi_yoy',
  effectiveFrom: date(on),
  value: new Decimal(value),
});

describe('projectBondValue', () => {
  it('agrees with the accrual engine, because it is the accrual engine', () => {
    // A projection that drifted from the current valuation would be two
    // engines disagreeing about the same bond.
    const projected = projectBondValue(
      terms('TOS0829', '2026-08-01', '0.044'),
      purchase('TOS0829', '2026-08-01'),
      date('2027-08-01'),
      [],
    );

    expect(projected.accrual.accruedInterest).toEqual(pln('4.40'));
  });

  it('calls a fixed family actual, because there is no index to be wrong about', () => {
    const projected = projectBondValue(
      terms('TOS0829', '2026-08-01', '0.044'),
      purchase('TOS0829', '2026-08-01'),
      date('2029-08-01'),
      [],
    );

    expect(projected.basis).toEqual({ kind: 'actual' });
  });

  it('says when it leaned on the last known print', () => {
    // EDO in 2036 cannot know 2035's inflation. The engine happily reads
    // today's observation for that period — correct arithmetic, and a guess
    // about the world, so it has to be named.
    const projected = projectBondValue(
      terms('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01'),
      date('2036-08-01'),
      [cpi('2026-08-01', '0.03')],
    );

    expect(projected.basis).toEqual({ kind: 'last_known_index', from: date('2026-08-01') });
  });
});

describe('projectBondCashFlows', () => {
  it('gives a capitalizing family exactly one flow, at redemption', () => {
    // Not a missing schedule — it is what "kapitalizacja: roczna, wypłata przy
    // wykupie" means.
    const projection = projectBondCashFlows(
      terms('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01'),
      date('2026-08-15'),
      [cpi('2026-08-01', '0.03')],
    );

    expect(projection.cashFlows).toHaveLength(1);
    expect(projection.cashFlows[0]?.kind).toBe('redemption');
    expect(projection.redeemsOn.toString()).toBe('2036-08-01');
  });

  it('schedules one payment per year for COI, plus the redemption', () => {
    const projection = projectBondCashFlows(
      terms('COI0830', '2026-08-01', '0.0475', '0.015'),
      purchase('COI0830', '2026-08-01'),
      date('2026-08-15'),
      [cpi('2026-08-01', '0.03')],
    );

    // Four annual payouts and the return of nominal.
    expect(projection.cashFlows.filter((flow) => flow.kind === 'interest')).toHaveLength(4);
    expect(projection.cashFlows.at(-1)?.kind).toBe('redemption');
    expect(projection.cashFlows[0]?.amount).toEqual(pln('4.75'));
  });

  it('schedules twelve monthly payments for ROR', () => {
    const projection = projectBondCashFlows(
      terms('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-09-15'),
      [
        {
          indexId: 'nbp_reference',
          effectiveFrom: date('2026-03-05'),
          value: new Decimal('0.0375'),
        },
      ],
    );

    expect(projection.cashFlows.filter((flow) => flow.kind === 'interest')).toHaveLength(12);
    // The first month is the one the published table covers.
    expect(projection.cashFlows[0]?.amount).toEqual(pln('0.33'));
  });

  it('redeems a capitalizing family at nominal plus everything it kept', () => {
    const projection = projectBondCashFlows(
      terms('TOS0829', '2026-08-01', '0.044'),
      purchase('TOS0829', '2026-08-01'),
      date('2026-08-15'),
      [],
    );

    // Three capitalized years at 4.40%, each accruing on the last one's close:
    // 100 → +4.40 → 104.40 → +4.59 → 108.99 → +4.80 → 113.79.
    expect(projection.redemptionValue).toEqual(pln('113.79'));
  });

  it('scales the schedule with the holding', () => {
    const projection = projectBondCashFlows(
      terms('COI0830', '2026-08-01', '0.0475', '0.015'),
      purchase('COI0830', '2026-08-01', 10),
      date('2026-08-15'),
      [cpi('2026-08-01', '0.03')],
    );

    expect(projection.cashFlows[0]?.amount).toEqual(pln('47.50'));
  });

  it('labels every flow with the basis it was computed on', () => {
    const projection = projectBondCashFlows(
      terms('COI0830', '2026-08-01', '0.0475', '0.015'),
      purchase('COI0830', '2026-08-01'),
      date('2026-08-15'),
      [cpi('2026-08-01', '0.03')],
    );

    // Every one, not just the summary — a flow shown on its own must still say
    // whether its number is arithmetic or an assumption.
    expect(projection.cashFlows.every((flow) => flow.basis.kind === 'last_known_index')).toBe(true);
  });
});

describe('projectEarlyRedemption', () => {
  it('walks the range day by day', () => {
    const points = projectEarlyRedemption(
      terms('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-09-01'),
      date('2026-09-05'),
      [],
    );

    expect(points).toHaveLength(5);
    expect(points[0]?.on.toString()).toBe('2026-09-01');
    expect(points.at(-1)?.on.toString()).toBe('2026-09-05');
  });

  it('shows the fee being absorbed as interest accrues', () => {
    // The question the fee actually raises: early on, redeeming returns exactly
    // nominal because the 0.50 zł fee eats all the interest there is.
    const points = projectEarlyRedemption(
      terms('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-09-01'),
      date('2026-09-30'),
      [],
    );

    expect(points[0]?.value).toEqual(pln('100.00'));
    // By the end of the first period 0.33 has accrued, still under the fee.
    expect(points.at(-1)?.value).toEqual(pln('100.00'));
  });

  it('stops at redemption rather than running past it', () => {
    const points = projectEarlyRedemption(
      terms('OTS1126', '2026-08-01', '0.02'),
      purchase('OTS1126', '2026-08-01'),
      date('2026-10-30'),
      date('2027-06-01'),
      [],
    );

    expect(points.at(-1)?.on.toString()).toBe('2026-11-01');
  });

  it('returns nothing for a backwards range rather than looping forever', () => {
    const points = projectEarlyRedemption(
      terms('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-09-30'),
      date('2026-09-01'),
      [],
    );

    expect(points).toEqual([]);
  });
});

describe('the schedule sums to what the bond actually pays', () => {
  // The invariant `projectBondCashFlows` exists to satisfy, and the one that
  // catches the whole class of error: total flows = nominal + all interest.
  // Asserting flow *counts* and the first amount — which is all the tests above
  // did — let a paying family's final period be emitted twice, once as its own
  // interest flow and again inside the redemption, while `redemptionValue`
  // stayed correct on its own and hid it.
  const cases = [
    ['COI0830', '0.0475', '0.015', 4] as const,
    ['ROR0827', '0.04', '0', 12] as const,
    ['DOR0828', '0.0415', '0.0015', 24] as const,
    ['EDO0836', '0.0535', '0.02', 1] as const,
    ['TOS0829', '0.044', '0', 1] as const,
  ];

  it.each(cases)('%s flows sum to nominal plus total interest', (code, rate, margin) => {
    const settledOn = '2026-08-01';
    const t = terms(code, settledOn, rate, margin);
    const held = purchase(code, settledOn);
    const projection = projectBondCashFlows(t, held, date(settledOn), [
      cpi('2026-07-01', '0.03'),
      { indexId: 'nbp_reference', effectiveFrom: date('2026-03-05'), value: new Decimal('0.0375') },
    ]);

    const total = projection.cashFlows.reduce((sum, flow) => sum.plus(flow.amount), pln('0'));
    const atMaturity = projectBondValue(t, held, projection.redeemsOn, [
      cpi('2026-07-01', '0.03'),
      { indexId: 'nbp_reference', effectiveFrom: date('2026-03-05'), value: new Decimal('0.0375') },
    ]).accrual;

    const owed = atMaturity.nominal.plus(atMaturity.accruedInterest).plus(atMaturity.paidInterest);
    expect(total).toEqual(owed);
  });

  it('emits one interest flow per period for a payer, and the nominal once', () => {
    const projection = projectBondCashFlows(
      terms('COI0830', '2026-08-01', '0.0475', '0.015'),
      purchase('COI0830', '2026-08-01'),
      date('2026-08-01'),
      [cpi('2026-07-01', '0.03')],
    );

    const redemptions = projection.cashFlows.filter((flow) => flow.kind === 'redemption');
    expect(redemptions).toHaveLength(1);
    // Nominal alone — the final period is already its own interest flow.
    expect(redemptions[0]?.amount).toEqual(pln('100.00'));
  });
});
