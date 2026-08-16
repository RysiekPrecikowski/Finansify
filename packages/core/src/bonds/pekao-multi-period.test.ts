import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { Temporal } from '../time';
import { accrueBond } from './accrue-bond';
import { resolveFamilyRules } from './families';
import { parseSeriesCode } from './series-code';
import { type BondTerms, type IndexObservation } from './types';
import nbpRates from './__fixtures__/nbp-reference-rates.json';
import issues from './__fixtures__/pekao-multi-period.json';

/**
 * The half of the engine the first-period tables cannot reach.
 *
 * `pekao-golden.test.ts` covers five families, but only their **first** interest
 * period — whose rate comes from the emission letter, fixed. That leaves the
 * three things most likely to be wrong completely untested: capitalization onto
 * a grown base, the monthly rate reset, and the rule picking which index
 * observation governs a period.
 *
 * These fixtures are older issues with a full history: TOS0727 across three
 * capitalized years, ROR0726 and DOR0726 across twelve monthly resets each —
 * 1850 published day-values, and 22 real rate changes decided by the RPP.
 *
 * Retrieved from Bank Pekao's API on 2026-08-16, same endpoints as ADR 0016.
 */

const d = (iso: string) => Temporal.PlainDate.from(iso);

const fromPolishDate = (value: string) => {
  const [day = '', month = '', year = ''] = value.split('.');
  return d(`${year}-${month}-${day}`);
};

const asFraction = (percent: string) =>
  new Decimal(percent.replace('%', '').replace(',', '.').trim()).dividedBy(100);

/** The real NBP reference-rate history, as the engine's ports would deliver it. */
const observations: readonly IndexObservation[] = nbpRates.map((rate) => ({
  indexId: 'nbp_reference',
  effectiveFrom: d(rate.effectiveFrom),
  value: new Decimal(rate.valueFraction),
}));

type Issue = (typeof issues)[keyof typeof issues];

function termsFor(issue: Issue, settledOn: Temporal.PlainDate): BondTerms {
  const parsed = parseSeriesCode(issue.series);
  return {
    seriesCode: parsed.code,
    rules: resolveFamilyRules(parsed.family, settledOn),
    firstPeriodRate: asFraction(issue.periods[0]?.ratePercent ?? '0%'),
    // Per **issue**, not per family, and this fixture is why that matters:
    // DOR0726 carries a 0.35% margin while the current DOR0828 carries 0.15%.
    // A margin held on the family would misprice one of them by 20 basis
    // points for its whole life.
    margin: new Decimal(issue.marginFraction),
  };
}

describe.each(Object.values(issues))('$series — every published period', (issue) => {
  const settledOn = fromPolishDate(issue.periods[0]!.from);
  const terms = termsFor(issue, settledOn);
  const purchase = { seriesCode: terms.seriesCode, settledOn, quantity: 1 };

  it('derives the rate the Ministry published, for every period after the first', () => {
    // The indexation rule under test: the latest observation effective
    // *strictly before* the period opens. Twelve monthly resets per series,
    // against the RPP's real decisions — no synthetic index anywhere.
    if (issue.indexId === null) return;

    const wrong: string[] = [];
    for (const period of issue.periods) {
      if (period.ordinal === 1) continue;

      // Asked at the period's *end*, and matched by ordinal rather than by
      // "the last one". On a period's exact start date the engine is still
      // reporting the one that closed that day — the accrued-not-yet-paid
      // convention the ROR golden table pinned down — so `periods.at(-1)`
      // there answers about the previous period. Reading it that way is how a
      // rate change gets attributed to the wrong month.
      const accrual = accrueBond(terms, purchase, fromPolishDate(period.to), observations);
      const derived = accrual.periods.find((p) => p.ordinal === period.ordinal)?.annualRate;
      const published = asFraction(period.ratePercent);

      if (derived === undefined || !derived.equals(published)) {
        wrong.push(
          `period ${period.ordinal} from ${period.from}: derived ${derived?.times(100).toFixed(2) ?? '—'}%, published ${period.ratePercent}`,
        );
      }
    }

    expect(wrong, `${issue.series} derives a different rate than the Ministry published`).toEqual(
      [],
    );
  });

  it('reproduces every published day across every period', () => {
    const mismatches: string[] = [];
    let checked = 0;

    for (const period of issue.periods) {
      for (const entry of period.accruedByDate) {
        const [on = '', expected = ''] = entry;
        checked += 1;
        const accrued = accrueBond(
          terms,
          purchase,
          d(on),
          observations,
        ).accruedInterest.amount.toFixed(2);
        if (accrued !== expected) {
          mismatches.push(`P${period.ordinal} ${on}: got ${accrued}, published ${expected}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(300);
    expect(
      mismatches.slice(0, 12),
      `${issue.series} disagrees on ${mismatches.length} of ${checked} published days`,
    ).toEqual([]);
  });
});

describe('TOS0727 — capitalization across three years', () => {
  const issue = issues.TOS0727;
  const settledOn = fromPolishDate(issue.periods[0]!.from);
  const terms = termsFor(issue, settledOn);
  const purchase = { seriesCode: terms.seriesCode, settledOn, quantity: 1 };

  it('accrues each year on the previous year’s close, not on nominal', () => {
    // A fixed 6.20% for three years. If the engine accrued every year on 100
    // the totals would be 6.20 / 12.40 / 18.60; capitalized they are larger,
    // and the published tables are what decide which is right.
    const periods = accrueBond(
      terms,
      purchase,
      fromPolishDate(issue.periods[2]!.to),
      observations,
    ).periods;

    expect(periods).toHaveLength(3);
    const bases = periods.map((period) => period.base.amount.toFixed(2));
    expect(bases[0]).toBe('100.00');
    expect(Number(bases[1])).toBeGreaterThan(100);
    expect(Number(bases[2])).toBeGreaterThan(Number(bases[1]));
  });

  it('keeps every year’s interest unpaid until redemption', () => {
    const atEnd = accrueBond(terms, purchase, fromPolishDate(issue.periods[2]!.to), observations);
    expect(atEnd.paidInterest.amount.toFixed(2)).toBe('0.00');
  });
});

describe('ROR0726 — monthly payout', () => {
  const issue = issues.ROR0726;
  const settledOn = fromPolishDate(issue.periods[0]!.from);
  const terms = termsFor(issue, settledOn);
  const purchase = { seriesCode: terms.seriesCode, settledOn, quantity: 1 };

  it('pays each month out instead of compounding it', () => {
    // Twelve months in, a payer has handed over eleven completed months and is
    // accruing the twelfth — the opposite of TOS above, on the same engine.
    const late = accrueBond(terms, purchase, d('2026-06-15'), observations);

    expect(late.paidInterest.amount.greaterThan(0)).toBe(true);
    expect(late.currentValue.amount.toFixed(2)).toBe(
      late.nominal.plus(late.accruedInterest).amount.toFixed(2),
    );
  });
});

describe('the multi-period fixture', () => {
  it('carries the real RPP decisions rather than a synthetic series', () => {
    // 2025 alone had five cuts. A fixture with a flat rate would pass the
    // indexation test while testing nothing.
    const distinct = new Set(nbpRates.map((rate) => rate.valueFraction));
    expect(distinct.size).toBeGreaterThan(5);
  });

  it('covers both a capitalizing and a paying family across many periods', () => {
    expect(Object.keys(issues).sort()).toEqual(['DOR0726', 'ROR0726', 'TOS0727']);
    const totalPeriods = Object.values(issues).reduce(
      (count, issue) => count + issue.periods.length,
      0,
    );
    expect(totalPeriods).toBeGreaterThanOrEqual(27);
  });
});
