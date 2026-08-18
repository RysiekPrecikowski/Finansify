import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { Temporal } from '../time';
import { accrueBond } from './accrue-bond';
import { resolveFamilyRules } from './families';
import { parseSeriesCode } from './series-code';
import { type BondAccrual, type BondFamily, type BondTerms, type IndexObservation } from './types';
import { valueBondFromTables } from './value-from-tables';
import { type BondInterestTable } from './interest-table';
import published from './__fixtures__/pekao-tables.json';

/**
 * Valuing a holding from the **published** tables rather than from our own
 * arithmetic, specified before it exists (rule 17).
 *
 * The contract in one line: given the tables for every period a holding has
 * lived through, this returns the same `BondAccrual` shape `accrueBond`
 * returns, built from the Ministry's figures instead of ours — and `null` the
 * moment any table it needs is absent or does not line up, so the caller falls
 * back to the engine rather than to a guess (rule 7).
 *
 * Two published conventions drive most of what follows, both measured on
 * Pekao's API rather than assumed:
 *
 * - A **paying** family's table restarts at 0,00 every period; interest from
 *   closed periods has left the account and belongs to `paidInterest`.
 * - A **capitalizing** family's table accumulates since issue, so the value
 *   read for today already contains every earlier period. Adding closed periods
 *   on top of it would count them twice.
 */

const PLN = currency('PLN');
const d = (iso: string) => Temporal.PlainDate.from(iso);

type Fixture = (typeof published)[number];

const PUBLISHED_PERCENT = /^\s*(-?\d+)(?:,(\d+))?\s*%?\s*$/;

const asFraction = (percent: string) => {
  const match = PUBLISHED_PERCENT.exec(percent);
  if (match === null) throw new Error(`"${percent}" is not a published percentage`);
  const [, whole = '', fraction] = match;
  return new Decimal(fraction === undefined ? whole : `${whole}.${fraction}`).dividedBy(100);
};

const tableFrom = (entry: Fixture): BondInterestTable => ({
  seriesCode: parseSeriesCode(entry.series).code,
  periodOrdinal: entry.periodOrdinal,
  purchaseDayKey: entry.purchaseDayKey as 1 | 29 | 30 | 31,
  startsOn: d(entry.startsOn),
  endsOn: d(entry.endsOn),
  annualRate: asFraction(entry.annualRatePercent),
  source: 'pekao',
  dailyValues: entry.dailyValues.map((value) => Money.of(value, PLN)),
});

/** Every day-1 table published for a series, keyed by period ordinal. */
const tablesFor = (series: string, ordinals?: readonly number[]) => {
  const map = new Map<number, BondInterestTable>();
  for (const entry of published) {
    if (entry.series !== series || entry.purchaseDayKey !== 1) continue;
    if (ordinals !== undefined && !ordinals.includes(entry.periodOrdinal)) continue;
    map.set(entry.periodOrdinal, tableFrom(entry));
  }
  return map;
};

const termsFor = (
  series: string,
  settledOn: string,
  firstPeriodRate: string,
  margin: string,
): BondTerms => {
  const parsed = parseSeriesCode(series);
  return {
    seriesCode: parsed.code,
    rules: resolveFamilyRules(parsed.family as BondFamily, d(settledOn)),
    firstPeriodRate: new Decimal(firstPeriodRate),
    margin: new Decimal(margin),
  };
};

/** ROR0726: 5,25% in period one, then the NBP reference rate plus nothing. */
const ror = (settledOn: string) => termsFor('ROR0726', settledOn, '0.0525', '0');
/** EDO0735: 6,25% in year one, then CPI plus a 2,00% margin, capitalized. */
const edo = (settledOn: string) => termsFor('EDO0735', settledOn, '0.0625', '0.02');

const zloty = (amount: string) => Money.of(amount, PLN);
const expectMoney = (actual: Money | undefined, expected: string) => {
  expect(actual?.amount.toFixed(2)).toBe(zloty(expected).amount.toFixed(2));
};

describe('valueBondFromTables — a paying family', () => {
  /**
   * The shape the user asked to see: nominal, the rate that governed last
   * month, the rate governing this one, what has accrued so far, and what the
   * holding is worth today. Two ROR0726 bought on 1 July 2025, valued on
   * 15 November 2025 — period 5, which the RPP had taken to 4,50% from the
   * 4,75% of period 4.
   */
  const accrual = () =>
    valueBondFromTables(
      ror('2025-07-01'),
      { seriesCode: parseSeriesCode('ROR0726').code, settledOn: d('2025-07-01'), quantity: 2 },
      d('2025-11-15'),
      tablesFor('ROR0726'),
    );

  it('values the holding from the published table', () => {
    const valued = accrual();
    expect(valued).not.toBeNull();
    expectMoney(valued?.nominal, '200.00');
    // 0,18 per bond on the fifteenth day of period five.
    expectMoney(valued?.accruedInterest, '0.36');
    expectMoney(valued?.currentValue, '200.36');
  });

  it('counts interest from closed periods as paid, never as accrued', () => {
    // 0,44 + 0,42 + 0,42 + 0,40 per bond, paid out monthly as ROR does.
    expectMoney(accrual()?.paidInterest, '3.36');
  });

  it('reports the rate of every period it has lived through', () => {
    const periods = accrual()?.periods ?? [];
    expect(periods).toHaveLength(5);
    expect(periods.at(-2)?.annualRate.toFixed(4)).toBe('0.0475');
    expect(periods.at(-1)?.annualRate.toFixed(4)).toBe('0.0450');
  });

  it('names the agent whose figures these are', () => {
    expect(accrual()?.source).toBe('pekao');
  });
});

describe('valueBondFromTables — a capitalizing family', () => {
  /**
   * EDO0735 bought on 1 July 2025, valued on 1 August 2026: a month into year
   * two, whose rate is CPI + 2,00%. The published 6,71 is 6,25 capitalized from
   * year one plus 0,46 of year two — the table carries both, so the accrual
   * must not add year one a second time.
   */
  const accrual = (asOf: string) =>
    valueBondFromTables(
      edo('2025-07-01'),
      { seriesCode: parseSeriesCode('EDO0735').code, settledOn: d('2025-07-01'), quantity: 2 },
      d(asOf),
      tablesFor('EDO0735'),
    );

  it('reads the cumulative value rather than summing periods', () => {
    const valued = accrual('2026-08-01');
    expectMoney(valued?.accruedInterest, '13.42');
    expectMoney(valued?.currentValue, '213.42');
  });

  it('pays nothing out along the way', () => {
    expectMoney(accrual('2026-08-01')?.paidInterest, '0.00');
  });

  it('reports both years’ rates', () => {
    const periods = accrual('2026-08-01')?.periods ?? [];
    expect(periods).toHaveLength(2);
    expect(periods[0]?.annualRate.toFixed(4)).toBe('0.0625');
    expect(periods[1]?.annualRate.toFixed(4)).toBe('0.0510');
  });

  /**
   * On the day a period closes the holding is still in that period, fully
   * accrued — the same convention `accrueBond` uses, and the same one the
   * published tables show by printing the closing figure on that date.
   */
  it('reads the closing figure on the boundary day, not the next period’s opening', () => {
    const valued = accrual('2026-07-01');
    expectMoney(valued?.accruedInterest, '12.50');
    expect(valued?.periods).toHaveLength(1);
  });
});

describe('valueBondFromTables — when it must refuse', () => {
  const purchase = {
    seriesCode: parseSeriesCode('ROR0726').code,
    settledOn: d('2025-07-01'),
    quantity: 1,
  };

  it('refuses when a period it has lived through was never published', () => {
    // Periods 1 to 5 have elapsed; only 1 and 5 are on hand, so the interest
    // paid out in between is unknown and cannot be assumed to be zero.
    const value = valueBondFromTables(
      ror('2025-07-01'),
      purchase,
      d('2025-11-15'),
      tablesFor('ROR0726', [1, 5]),
    );
    expect(value).toBeNull();
  });

  it('refuses when the current period has no table yet', () => {
    const value = valueBondFromTables(
      ror('2025-07-01'),
      purchase,
      d('2025-11-15'),
      tablesFor('ROR0726', [1, 2, 3, 4]),
    );
    expect(value).toBeNull();
  });

  it('refuses a date before settlement, where there is nothing published to read', () => {
    const value = valueBondFromTables(
      ror('2025-07-01'),
      purchase,
      d('2025-06-30'),
      tablesFor('ROR0726'),
    );
    expect(value).toBeNull();
  });

  it('refuses a table whose period length does not match the holding’s', () => {
    // Settled on the 31st, so this holding's periods are the month-end ones —
    // the day-1 tables describe different spans and must not be read for it.
    const settledOn = d('2026-01-31');
    const value = valueBondFromTables(
      ror('2026-01-31'),
      { seriesCode: parseSeriesCode('ROR0726').code, settledOn, quantity: 1 },
      d('2026-02-10'),
      tablesFor('ROR0726'),
    );
    expect(value).toBeNull();
  });
});

/**
 * The strongest check available: where both paths can answer, they must answer
 * the same. A disagreement is a real finding in whichever direction it falls —
 * either the engine has drifted from the Ministry, or the table is being read
 * wrongly — and neither is something to paper over.
 */
describe('the published tables and accrueBond agree to the grosz', () => {
  const sameMoney = (fromTables: BondAccrual, fromEngine: BondAccrual) => {
    expectMoney(fromTables.nominal, fromEngine.nominal.amount.toFixed(2));
    expectMoney(fromTables.accruedInterest, fromEngine.accruedInterest.amount.toFixed(2));
    expectMoney(fromTables.paidInterest, fromEngine.paidInterest.amount.toFixed(2));
    expectMoney(fromTables.currentValue, fromEngine.currentValue.amount.toFixed(2));
    expectMoney(fromTables.earlyRedemptionValue, fromEngine.earlyRedemptionValue.amount.toFixed(2));
  };

  it('agrees on a paying family inside its first period', () => {
    const terms = ror('2025-07-01');
    const purchase = {
      seriesCode: terms.seriesCode,
      settledOn: d('2025-07-01'),
      quantity: 3,
    };
    const asOf = d('2025-07-17');

    const fromTables = valueBondFromTables(terms, purchase, asOf, tablesFor('ROR0726'));
    expect(fromTables).not.toBeNull();
    sameMoney(fromTables!, accrueBond(terms, purchase, asOf, []));
  });

  it('agrees on a capitalizing family in its second year', () => {
    const terms = edo('2025-07-01');
    const purchase = {
      seriesCode: terms.seriesCode,
      settledOn: d('2025-07-01'),
      quantity: 2,
    };
    const asOf = d('2026-08-01');
    // Year two is CPI + 2,00%, and Pekao publishes it as 5,10% — so the print
    // the engine must be reading is 3,10%, announced before the year opened.
    const observations: readonly IndexObservation[] = [
      { indexId: 'pl_cpi_yoy', effectiveFrom: d('2026-06-01'), value: new Decimal('0.031') },
    ];

    const fromTables = valueBondFromTables(terms, purchase, asOf, tablesFor('EDO0735'));
    expect(fromTables).not.toBeNull();
    sameMoney(fromTables!, accrueBond(terms, purchase, asOf, observations));
  });
});
