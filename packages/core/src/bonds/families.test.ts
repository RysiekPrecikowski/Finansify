import { describe, expect, it } from 'vitest';

import { currency, Money } from '../money';
import { Temporal } from '../time';
import { bondFamilies, bondFamilyShapes, resolveFamilyRules } from './families';

const PLN = currency('PLN');
const date = (iso: string) => Temporal.PlainDate.from(iso);
const today = date('2026-08-14');

describe('the family registry', () => {
  it('has a shape for every family in the vocabulary', () => {
    for (const family of bondFamilies) {
      expect(bondFamilyShapes[family], `${family} has no rules`).toBeDefined();
    }
  });

  it('matches the tenor each family is named for', () => {
    const tenors = { OTS: 3, ROR: 12, DOR: 24, TOS: 36, COI: 48, ROS: 72, EDO: 120, ROD: 144 };
    for (const family of bondFamilies) {
      expect(resolveFamilyRules(family, today).tenorMonths).toBe(tenors[family]);
    }
  });

  it('resets monthly only for the two reference-rate families', () => {
    const monthly = bondFamilies.filter((f) => resolveFamilyRules(f, today).periodMonths === 1);
    expect(monthly).toEqual(['ROR', 'DOR']);
  });

  it('indexes exactly the families whose rate is not fixed', () => {
    const indexed = bondFamilies.filter((f) => resolveFamilyRules(f, today).indexId !== null);
    expect(indexed).toEqual(['ROR', 'DOR', 'COI', 'ROS', 'EDO', 'ROD']);
  });

  it('capitalizes for the long savings families and not for the payers', () => {
    const capitalizing = bondFamilies.filter((f) => resolveFamilyRules(f, today).capitalizes);
    // COI is the trap: it is CPI-indexed like EDO but pays out annually.
    expect(capitalizing).toEqual(['TOS', 'ROS', 'EDO', 'ROD']);
  });
});

describe('effective-dated early-redemption fees', () => {
  // Every figure below is from the family's own offer page. The commonly
  // repeated "0.70 / 2.00" pairing is wrong for anything bought today.
  it.each([
    ['ROR', '0.50', '0.50'],
    ['DOR', '0.70', '0.70'],
    ['TOS', '0.70', '1.00'],
    ['COI', '0.70', '2.00'],
    ['ROS', '0.70', '2.00'],
    ['EDO', '2.00', '3.00'],
    ['ROD', '2.00', '3.00'],
  ] as const)('charges %s %s before the 2024 revision and %s after', (family, before, after) => {
    const older = resolveFamilyRules(family, date('2024-08-31')).earlyRedemption;
    const newer = resolveFamilyRules(family, date('2024-09-01')).earlyRedemption;

    expect(older.kind).toBe('fee');
    expect(newer.kind).toBe('fee');
    if (older.kind !== 'fee' || newer.kind !== 'fee') return;
    expect(older.amountPerBond).toEqual(Money.of(before, PLN));
    expect(newer.amountPerBond).toEqual(Money.of(after, PLN));
  });

  it('forfeits interest rather than charging a fee for OTS', () => {
    expect(resolveFamilyRules('OTS', today).earlyRedemption).toEqual({ kind: 'forfeit_interest' });
  });

  it('caps only within the first period for the families that pay out', () => {
    for (const family of ['ROR', 'DOR', 'COI'] as const) {
      const rule = resolveFamilyRules(family, today).earlyRedemption;
      expect(rule.kind === 'fee' && rule.capping).toBe('first_period_only');
    }
    for (const family of ['TOS', 'ROS', 'EDO', 'ROD'] as const) {
      const rule = resolveFamilyRules(family, today).earlyRedemption;
      expect(rule.kind === 'fee' && rule.capping).toBe('always');
    }
  });
});
