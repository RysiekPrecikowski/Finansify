import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { Temporal } from '../time';
import { accrueBond } from './accrue-bond';
import { resolveFamilyRules } from './families';
import { parseSeriesCode } from './series-code';
import { type BondPurchase, type BondTerms, type IndexObservation } from './types';
import { ror0827Period1 } from './__fixtures__/ror0827-period-1';

/**
 * The specification for the accrual engine. Written before the engine exists
 * and handed over as the contract (rules 16 and 17) — an author tests what they
 * meant, a second reader tests what is there.
 *
 * Every rate and fee asserted here was read off the relevant family's own offer
 * page on obligacjeskarbowe.pl on 2026-08-14. The one set of figures that is
 * *golden* — reproduced from the Ministry's published day-by-day table rather
 * than derived from its prose — is the last block in this file.
 *
 * Two conventions the engine has to get right, both of them load-bearing and
 * neither obvious from the prose:
 *
 * 1. **Periods are measured from the settlement anchor, never iteratively.**
 *    Period n runs `settledOn.add({months: n × periodMonths})` to
 *    `settledOn.add({months: (n+1) × periodMonths})`. Stepping a month at a
 *    time drifts: 31 Aug + 1 month is 30 Sep, and 30 Sep + 1 month is 30 Oct,
 *    which is a day early. From the anchor it is 31 Oct, which is correct.
 * 2. **On a period's exact end date the interest is accrued, not yet paid.**
 *    The published table shows the full period's interest against its last day,
 *    so payment (or capitalization) happens once `asOf` is strictly past it.
 */

const PLN = currency('PLN');
const date = (iso: string) => Temporal.PlainDate.from(iso);
const pln = (amount: string) => Money.of(amount, PLN);

/** Compose terms the way `BondTermsResolver` will: family rules + two numbers. */
function termsFor(
  code: string,
  settledOn: string,
  firstPeriodRate: string,
  margin = '0',
): BondTerms {
  const parsed = parseSeriesCode(code);
  return {
    seriesCode: parsed.code,
    rules: resolveFamilyRules(parsed.family, date(settledOn)),
    firstPeriodRate: new Decimal(firstPeriodRate),
    margin: new Decimal(margin),
  };
}

function purchase(code: string, settledOn: string, quantity = 1): BondPurchase {
  return { seriesCode: parseSeriesCode(code).code, settledOn: date(settledOn), quantity };
}

function cpi(effectiveFrom: string, value: string): IndexObservation {
  return { indexId: 'pl_cpi_yoy', effectiveFrom: date(effectiveFrom), value: new Decimal(value) };
}

function nbp(effectiveFrom: string, value: string): IndexObservation {
  return {
    indexId: 'nbp_reference',
    effectiveFrom: date(effectiveFrom),
    value: new Decimal(value),
  };
}

describe('accrueBond — nominal and boundaries', () => {
  it('values a holding at its face value before any interest has accrued', () => {
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-08-31'),
      [],
    );

    expect(result.nominal).toEqual(pln('100.00'));
    expect(result.accruedInterest).toEqual(pln('0.00'));
    expect(result.currentValue).toEqual(pln('100.00'));
  });

  it('rounds interest per bond and only then scales by the holding', () => {
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31', 25),
      date('2026-09-30'),
      [],
    );

    // The Ministry's tables are published "dla 1 sztuki obligacji" and interest
    // is paid per bond, so the grosz rounding happens per bond and the holding
    // is a multiple of it: 25 × 0.33 = 8.25. Rounding the holding as a whole
    // would give 8.33, which is not what lands in the account.
    expect(result.nominal).toEqual(pln('2500.00'));
    expect(result.accruedInterest).toEqual(pln('8.25'));
  });

  it('accrues nothing for a date before settlement', () => {
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-08-01'),
      [],
    );

    expect(result.accruedInterest).toEqual(pln('0.00'));
    expect(result.periods).toHaveLength(0);
  });

  it('stops accruing at redemption rather than running past it', () => {
    const terms = termsFor('OTS1126', '2026-08-01', '0.02');
    const atRedemption = accrueBond(
      terms,
      purchase('OTS1126', '2026-08-01'),
      date('2026-11-01'),
      [],
    );
    const longAfter = accrueBond(terms, purchase('OTS1126', '2026-08-01'), date('2030-01-01'), []);

    expect(longAfter.accruedInterest).toEqual(atRedemption.accruedInterest);
    expect(longAfter.currentValue).toEqual(atRedemption.currentValue);
  });
});

describe('accrueBond — OTS, three months fixed', () => {
  // The offer page for OTS1126 states the whole-term interest outright:
  // "Odsetki: 0,50 zł" at 2.00% annualized. 100 × 0.02 × 3/12 = 0.50.
  it('pays exactly the interest the offer page states for the full term', () => {
    const result = accrueBond(
      termsFor('OTS1126', '2026-08-01', '0.02'),
      purchase('OTS1126', '2026-08-01'),
      date('2026-11-01'),
      [],
    );

    expect(result.accruedInterest).toEqual(pln('0.50'));
    expect(result.currentValue).toEqual(pln('100.50'));
  });

  it('forfeits all interest on early redemption instead of charging a fee', () => {
    const result = accrueBond(
      termsFor('OTS1126', '2026-08-01', '0.02'),
      purchase('OTS1126', '2026-08-01'),
      date('2026-10-01'),
      [],
    );

    expect(result.accruedInterest.isPositive()).toBe(true);
    // "klient (…) otrzyma całą wpłaconą kwotę – 100 zł (…) odsetki nie zostaną naliczone"
    expect(result.earlyRedemptionValue).toEqual(pln('100.00'));
  });
});

describe('accrueBond — TOS, three years fixed and capitalized', () => {
  const terms = termsFor('TOS0829', '2026-08-01', '0.044');
  const held = purchase('TOS0829', '2026-08-01');

  it('capitalizes the first year into the base the second year accrues on', () => {
    const afterOneYear = accrueBond(terms, held, date('2027-08-01'), []);
    const afterTwoYears = accrueBond(terms, held, date('2028-08-01'), []);

    expect(afterOneYear.accruedInterest).toEqual(pln('4.40'));
    // Year two accrues on 104.40, not on 100: 104.40 × 4.40% = 4.5936 → 4.59.
    expect(afterTwoYears.accruedInterest).toEqual(pln('8.99'));
    expect(afterTwoYears.currentValue).toEqual(pln('108.99'));
  });

  it('never pays interest out before redemption', () => {
    const afterTwoYears = accrueBond(terms, held, date('2028-08-01'), []);
    expect(afterTwoYears.paidInterest).toEqual(pln('0.00'));
  });

  it('reports the rate on every elapsed period, all of them the fixed one', () => {
    const result = accrueBond(terms, held, date('2028-08-01'), []);
    expect(result.periods).toHaveLength(2);
    for (const period of result.periods) {
      expect(period.annualRate.toFixed(4)).toBe('0.0440');
    }
  });
});

describe('accrueBond — ROR and DOR, monthly against the NBP reference rate', () => {
  it('takes the first period from the emission letter, not from the index', () => {
    // The offer page fixes ROR0827's first month at 4.00% while the NBP
    // reference rate was 3.75% — reading the index for period one would be wrong.
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-09-30'),
      [nbp('2026-03-05', '0.0375')],
    );

    expect(result.periods[0]?.annualRate.toFixed(4)).toBe('0.0400');
    expect(result.accruedInterest).toEqual(pln('0.33'));
  });

  it('uses the reference rate in force before the period starts, plus the margin', () => {
    // DOR is reference + 0.15%. Period two starts 2026-09-30; the rate in force
    // then is the 2026-09-02 observation, not the later one.
    const result = accrueBond(
      termsFor('DOR0828', '2026-08-31', '0.0415', '0.0015'),
      purchase('DOR0828', '2026-08-31'),
      date('2026-10-31'),
      [nbp('2026-03-05', '0.0375'), nbp('2026-09-02', '0.035'), nbp('2026-10-07', '0.0325')],
    );

    expect(result.periods[1]?.annualRate.toFixed(4)).toBe('0.0365');
  });

  it('pays each month out rather than capitalizing it', () => {
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-10-31'),
      [nbp('2026-03-05', '0.0375')],
    );

    // Month one (0.33) has been paid; only month two is still accrued, and the
    // holding is still worth its nominal plus that month.
    expect(result.paidInterest).toEqual(pln('0.33'));
    expect(result.currentValue).toEqual(pln('100.00').plus(result.accruedInterest));
  });
});

describe('accrueBond — the CPI-indexed families', () => {
  const observations = [cpi('2026-07-01', '0.03'), cpi('2027-07-01', '0.025')];

  it('adds the margin to the inflation print announced before the period', () => {
    // EDO0836: 5.35% first year, then CPI + 2.00%.
    const result = accrueBond(
      termsFor('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01'),
      date('2028-08-01'),
      observations,
    );

    expect(result.periods[0]?.annualRate.toFixed(4)).toBe('0.0535');
    // Year two starts 2027-08-01; the print announced before it is 2.5%.
    expect(result.periods[1]?.annualRate.toFixed(4)).toBe('0.0450');
  });

  it('floors a negative inflation print at zero, leaving the margin alone', () => {
    // "w przypadku ujemnej stopy inflacji do ustalania oprocentowania brana
    // jest wartość zerowa" — so the second year is the margin, not margin+CPI.
    const result = accrueBond(
      termsFor('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01'),
      date('2028-08-01'),
      [cpi('2027-07-01', '-0.012')],
    );

    expect(result.periods[1]?.annualRate.toFixed(4)).toBe('0.0200');
  });

  it('capitalizes for EDO but pays out for COI', () => {
    // Two full years, so the first period is genuinely behind us in both cases.
    const edo = accrueBond(
      termsFor('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01'),
      date('2028-08-01'),
      observations,
    );
    const coi = accrueBond(
      termsFor('COI0830', '2026-08-01', '0.0475', '0.015'),
      purchase('COI0830', '2026-08-01'),
      date('2028-08-01'),
      observations,
    );

    // EDO keeps everything: year two accrues on 105.35 at CPI 2.5% + 2.00%,
    // giving 4.74, and nothing has been paid out.
    expect(edo.paidInterest).toEqual(pln('0.00'));
    expect(edo.accruedInterest).toEqual(pln('10.09'));
    expect(edo.currentValue).toEqual(pln('110.09'));

    // COI paid year one out, so year two accrues on 100 again at CPI + 1.50%.
    expect(coi.paidInterest).toEqual(pln('4.75'));
    expect(coi.accruedInterest).toEqual(pln('4.00'));
    expect(coi.currentValue).toEqual(pln('104.00'));
  });

  it('refuses to invent an index value when none has been observed', () => {
    expect(() =>
      accrueBond(
        termsFor('EDO0836', '2026-08-01', '0.0535', '0.02'),
        purchase('EDO0836', '2026-08-01'),
        date('2028-08-01'),
        [],
      ),
    ).toThrow(/pl_cpi_yoy/);
  });
});

describe('accrueBond — early redemption', () => {
  it('caps the fee at accrued interest during the first period', () => {
    // ROR's fee is 0.50 zł; two days in, only 0.02 zł has accrued.
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-09-02'),
      [],
    );

    expect(result.accruedInterest).toEqual(pln('0.02'));
    expect(result.earlyRedemptionValue).toEqual(pln('100.00'));
  });

  it('charges a first-period-only fee in full once past the first period', () => {
    // From period two the fee comes out of the redemption amount even when it
    // exceeds that period's accrued interest.
    const result = accrueBond(
      termsFor('ROR0827', '2026-08-31', '0.04'),
      purchase('ROR0827', '2026-08-31'),
      date('2026-10-01'),
      [nbp('2026-03-05', '0.0375')],
    );

    const withoutFee = pln('100.00').plus(result.accruedInterest);
    expect(result.earlyRedemptionValue).toEqual(withoutFee.minus(pln('0.50')));
  });

  it('always caps the fee at accrued interest for the capitalizing families', () => {
    // EDO bought from 2024-09-01 carries a 3.00 zł fee, capped at accrued.
    const result = accrueBond(
      termsFor('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01'),
      date('2026-08-20'),
      [],
    );

    expect(result.accruedInterest.lessThan(pln('3.00'))).toBe(true);
    expect(result.earlyRedemptionValue).toEqual(pln('100.00'));
  });

  it('deducts the fee once per bond, not once per holding', () => {
    const result = accrueBond(
      termsFor('EDO0836', '2026-08-01', '0.0535', '0.02'),
      purchase('EDO0836', '2026-08-01', 10),
      date('2027-08-01'),
      [],
    );

    // 10 bonds: 1053.50 gross, less 10 × 3.00 zł.
    expect(result.currentValue).toEqual(pln('1053.50'));
    expect(result.earlyRedemptionValue).toEqual(pln('1023.50'));
  });
});

describe('accrueBond — the golden table', () => {
  it('reproduces every published day of ROR0827 to the grosz', () => {
    const terms = termsFor('ROR0827', ror0827Period1.settledOn, ror0827Period1.annualRate);
    const held = purchase('ROR0827', ror0827Period1.settledOn);

    for (const [on, expected] of ror0827Period1.accruedByDate) {
      const result = accrueBond(terms, held, date(on), []);
      expect(
        result.accruedInterest.amount.toFixed(2),
        `accrued interest on ${on} must match the Ministry's table`,
      ).toBe(expected);
    }
  });
});
