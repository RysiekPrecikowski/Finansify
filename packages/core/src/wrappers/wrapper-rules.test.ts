import { describe, expect, it } from 'vitest';

import { wrappers } from '../ledger/vocabulary';
import { currency as toCurrency, Money } from '../money';
import {
  contributionRoomFor,
  isTaxExempt,
  publishedWrapperRules,
  UnknownWrapperRulesError,
  type WrapperRules,
} from './wrapper-rules';

const PLN = toCurrency('PLN');
const pln = (amount: string) => Money.of(amount, PLN);

const rules: readonly WrapperRules[] = [
  {
    wrapper: 'ike',
    year: 2026,
    contributionLimit: pln('20000'),
    selfEmployedLimit: null,
    taxExempt: true,
    source: 'test',
  },
  {
    wrapper: 'brokerage',
    year: 2026,
    contributionLimit: null,
    selfEmployedLimit: null,
    taxExempt: false,
    source: 'test',
  },
];

describe('contributionRoomFor', () => {
  it('reports what is left under a capped wrapper', () => {
    const room = contributionRoomFor(rules, 'ike', 2026, pln('12000'));

    expect(room.remaining).toEqual(pln('8000'));
    expect(room.isExceeded).toBe(false);
  });

  it('clamps remaining at zero and flags the excess separately', () => {
    // A negative "remaining" reads as room in the wrong direction; the fact
    // that the cap was breached is carried by its own flag.
    const room = contributionRoomFor(rules, 'ike', 2026, pln('20400'));

    expect(room.remaining).toEqual(pln('0'));
    expect(room.isExceeded).toBe(true);
  });

  it('reports exactly full as not exceeded', () => {
    const room = contributionRoomFor(rules, 'ike', 2026, pln('20000'));

    expect(room.remaining).toEqual(pln('0'));
    expect(room.isExceeded).toBe(false);
  });

  it('distinguishes "no cap" from "no room left"', () => {
    // `null` and zero must not collapse into each other: one means a brokerage
    // account, the other means a full IKE.
    const room = contributionRoomFor(rules, 'brokerage', 2026, pln('999999'));

    expect(room.limit).toBeNull();
    expect(room.remaining).toBeNull();
    expect(room.isExceeded).toBe(false);
  });

  it('refuses a year it has no figure for rather than reusing the last one', () => {
    expect(() => contributionRoomFor(rules, 'ike', 2019, pln('0'))).toThrow(
      UnknownWrapperRulesError,
    );
  });
});

describe("IKZE's two limits", () => {
  it('gives the self-employed the higher cap', () => {
    const standard = contributionRoomFor(publishedWrapperRules, 'ikze', 2026, pln('0'));
    const business = contributionRoomFor(
      publishedWrapperRules,
      'ikze',
      2026,
      pln('0'),
      'self_employed',
    );

    expect(standard.limit).toEqual(pln('11304'));
    expect(business.limit).toEqual(pln('16956'));
  });

  it('falls back to the single limit for years before the split', () => {
    // 2020 published one figure for everyone; asking as self-employed must not
    // return null and read as "uncapped".
    const business = contributionRoomFor(
      publishedWrapperRules,
      'ikze',
      2020,
      pln('0'),
      'self_employed',
    );

    expect(business.limit).toEqual(pln('6272.40'));
  });

  it('ignores the status for every wrapper that has only one limit', () => {
    const standard = contributionRoomFor(publishedWrapperRules, 'ike', 2026, pln('0'));
    const business = contributionRoomFor(
      publishedWrapperRules,
      'ike',
      2026,
      pln('0'),
      'self_employed',
    );

    expect(business.limit).toEqual(standard.limit);
  });
});

describe('isTaxExempt', () => {
  it('answers per wrapper', () => {
    expect(isTaxExempt(publishedWrapperRules, 'ike', 2026)).toBe(true);
    expect(isTaxExempt(publishedWrapperRules, 'ikze', 2026)).toBe(true);
    expect(isTaxExempt(publishedWrapperRules, 'brokerage', 2026)).toBe(false);
  });

  it('refuses an unknown year rather than assuming taxable', () => {
    expect(() => isTaxExempt(publishedWrapperRules, 'ike', 2019)).toThrow(UnknownWrapperRulesError);
  });
});

describe('publishedWrapperRules', () => {
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

  it('covers every wrapper for every seeded year', () => {
    for (const wrapper of wrappers) {
      for (const year of years) {
        expect(
          publishedWrapperRules.some((rule) => rule.wrapper === wrapper && rule.year === year),
          `${wrapper} ${year} is missing`,
        ).toBe(true);
      }
    }
  });

  // Transcribed from the KNF's own tables. These are the assertions that would
  // have caught the figures being a year stale, which is exactly what happened
  // when they were first written from memory.
  it.each([
    [2026, '28260'],
    [2025, '26019'],
    [2024, '23472'],
    [2023, '20805'],
    [2022, '17766'],
    [2021, '15777'],
    [2020, '15681'],
  ])('IKE %s is %s zł', (year, limit) => {
    expect(contributionRoomFor(publishedWrapperRules, 'ike', year, pln('0')).limit).toEqual(
      pln(limit),
    );
  });

  it.each([
    [2026, '11304', '16956'],
    [2025, '10407.60', '15611.40'],
    [2024, '9388.80', '14083.20'],
    [2023, '8322', '12483'],
    [2022, '7106.40', '10659.60'],
    [2021, '6310.80', '9466.20'],
  ])('IKZE %s is %s zł, or %s zł self-employed', (year, standard, business) => {
    expect(contributionRoomFor(publishedWrapperRules, 'ikze', year, pln('0')).limit).toEqual(
      pln(standard),
    );
    expect(
      contributionRoomFor(publishedWrapperRules, 'ikze', year, pln('0'), 'self_employed').limit,
    ).toEqual(pln(business));
  });

  it('rises every year, which is what a wage-linked cap does', () => {
    // A transcription slip that swapped two years would break this without
    // needing anyone to remember which figure belongs where.
    for (const wrapper of ['ike', 'ikze'] as const) {
      const limits = years.map(
        (year) => contributionRoomFor(publishedWrapperRules, wrapper, year, pln('0')).limit,
      );
      for (let index = 1; index < limits.length; index += 1) {
        expect(
          limits[index]?.greaterThan(limits[index - 1]!),
          `${wrapper} ${years[index]} should exceed ${years[index - 1]}`,
        ).toBe(true);
      }
    }
  });

  it('cites a source on every row', () => {
    for (const rule of publishedWrapperRules) {
      expect(rule.source.length, `${rule.wrapper} ${rule.year} has no source`).toBeGreaterThan(0);
    }
  });

  it('leaves brokerage and PPK uncapped', () => {
    for (const wrapper of ['brokerage', 'ppk'] as const) {
      expect(contributionRoomFor(publishedWrapperRules, wrapper, 2026, pln('0')).limit).toBeNull();
    }
  });
});
