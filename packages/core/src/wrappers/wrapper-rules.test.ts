import { describe, expect, it } from 'vitest';

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
  { wrapper: 'ike', year: 2026, contributionLimit: pln('20000'), taxExempt: true },
  { wrapper: 'brokerage', year: 2026, contributionLimit: null, taxExempt: false },
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
    // The IKE cap moves every year with average earnings. Carrying one forward
    // would tell a user they have room they do not have.
    expect(() => contributionRoomFor(rules, 'ike', 2027, pln('0'))).toThrow(
      UnknownWrapperRulesError,
    );
  });
});

describe('isTaxExempt', () => {
  it('answers per wrapper', () => {
    expect(isTaxExempt(rules, 'ike', 2026)).toBe(true);
    expect(isTaxExempt(rules, 'brokerage', 2026)).toBe(false);
  });

  it('refuses an unknown year rather than assuming taxable', () => {
    expect(() => isTaxExempt(rules, 'ike', 2027)).toThrow(UnknownWrapperRulesError);
  });
});

describe('publishedWrapperRules', () => {
  it('states the brokerage case, which is true by definition', () => {
    const brokerage = publishedWrapperRules.find((rule) => rule.wrapper === 'brokerage');

    expect(brokerage?.contributionLimit).toBeNull();
    expect(brokerage?.taxExempt).toBe(false);
  });

  it('carries no IKE or IKZE figure, because none was verifiable', () => {
    // This assertion exists to make a future addition deliberate. The caps are
    // announced annually; entering one from memory rather than from the
    // announcement is the failure mode this guards.
    const announced = publishedWrapperRules.filter(
      (rule) => rule.wrapper === 'ike' || rule.wrapper === 'ikze',
    );

    expect(announced).toEqual([]);
  });
});
