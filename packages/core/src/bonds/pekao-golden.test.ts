import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { Temporal } from '../time';
import { accrueBond } from './accrue-bond';
import { resolveFamilyRules } from './families';
import { parseSeriesCode } from './series-code';
import { type BondTerms } from './types';
import tables from './__fixtures__/pekao-interest-tables.json';

/**
 * Golden tests against the **official daily interest tables** published by Bank
 * Pekao S.A., an emission agent for the State Treasury.
 *
 * `docs/domain.md` requires the accrual engine to reproduce the Ministry's
 * published tables to the grosz before any bond value reaches a user. Until now
 * that was possible for exactly one series: obligacjeskarbowe.pl serves its
 * tables from a POST form that PKO's WAF answers with 403, so the only table
 * obtainable was whichever the page happened to default to.
 *
 * Pekao publishes the same tables through a plain JSON REST API — no
 * authentication, no form, no WAF:
 *
 *   GET /.rest/gb-emission-lists/{FAMILY}          → current series
 *   GET /.rest/gb-interest-tables/emissions/{SERIES}          → its periods
 *   GET /.rest/gb-interest-tables/emissions/{SERIES}/{PERIOD} → the daily table
 *
 * The fixture is the unmodified output of those calls for the first interest
 * period of each family's current issue, retrieved 2026-08-16. See ADR 0015.
 *
 * These are the Ministry's own figures, not this engine's: a change that makes
 * them fail is a change that makes the app pay a different number than the
 * bond actually pays.
 */

const d = (iso: string) => Temporal.PlainDate.from(iso);

/** The API dates in `DD.MM.YYYY`; everything else here is ISO. */
const fromPolishDate = (value: string) => {
  const [day = '', month = '', year = ''] = value.split('.');
  return d(`${year}-${month}-${day}`);
};

/** `"5,35%"` → `0.0535`, without `parseFloat` (rule 1). */
const asFraction = (percent: string) =>
  new Decimal(percent.replace('%', '').replace(',', '.').trim()).dividedBy(100);

type Table = (typeof tables)[keyof typeof tables];

function termsFor(table: Table): { terms: BondTerms; settledOn: Temporal.PlainDate } {
  const parsed = parseSeriesCode(table.series);
  const settledOn = fromPolishDate(table.interestFrom);

  return {
    settledOn,
    terms: {
      seriesCode: parsed.code,
      rules: resolveFamilyRules(parsed.family, settledOn),
      firstPeriodRate: asFraction(table.ratePercent),
      // Every fixture is a *first* interest period, whose rate comes from the
      // emission letter rather than from an index, so the margin never applies
      // and no observations are needed. That is what makes these five tables
      // comparable without a CPI or NBP series in the picture.
      margin: new Decimal(0),
    },
  };
}

describe.each(Object.entries(tables))('%s — the published daily table', (family, table) => {
  const { terms, settledOn } = termsFor(table);
  const purchase = { seriesCode: terms.seriesCode, settledOn, quantity: 1 };

  it(`reproduces every one of ${table.accruedByDate.length} published days to the grosz`, () => {
    const mismatches: string[] = [];

    for (const entry of table.accruedByDate) {
      const [on = '', expected = ''] = entry;
      const accrued = accrueBond(terms, purchase, d(on), []).accruedInterest.amount.toFixed(2);
      if (accrued !== expected) mismatches.push(`${on}: got ${accrued}, published ${expected}`);
    }

    expect(
      mismatches,
      `${table.series} disagrees with Bank Pekao's published table on ${mismatches.length} of ${table.accruedByDate.length} days`,
    ).toEqual([]);
  });

  it('agrees with the published first-period rate and dates', () => {
    // Guards the fixture itself: if a regeneration picked up a different issue,
    // the day values would still "pass" against their own rate while silently
    // describing a bond nobody holds.
    expect(parseSeriesCode(table.series).family).toBe(family);
    expect(terms.firstPeriodRate.isPositive()).toBe(true);
    expect(Temporal.PlainDate.compare(fromPolishDate(table.interestTo), settledOn)).toBeGreaterThan(
      0,
    );
  });

  it('starts at zero on the settlement day itself', () => {
    // The published tables all open at 0,00 on the day of purchase — interest
    // runs from that date, it does not include it.
    const first = table.accruedByDate[0];
    expect(first?.[1]).toBe('0.00');
    expect(accrueBond(terms, purchase, settledOn, []).accruedInterest.amount.toFixed(2)).toBe(
      '0.00',
    );
  });
});

describe('the fixture as a whole', () => {
  it('covers the five families Pekao publishes tables for', () => {
    // OTS pays a single sum at redemption and has no daily table; ROS and ROD
    // are family bonds distributed only by PKO. Their absence is a fact about
    // the source, not an oversight — see ADR 0015.
    expect(Object.keys(tables).sort()).toEqual(['COI', 'DOR', 'EDO', 'ROR', 'TOS']);
  });

  it('carries over a thousand independently published values', () => {
    const total = Object.values(tables).reduce(
      (count, table) => count + table.accruedByDate.length,
      0,
    );
    expect(total).toBeGreaterThan(1000);
  });
});
