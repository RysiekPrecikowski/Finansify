import { currency, Money } from '../money';
import { Temporal } from '../time';
import {
  bondFamilies,
  type BondFamily,
  type BondFamilyRules,
  type EarlyRedemptionRule,
  type IndexId,
  type PayoutSchedule,
} from './types';

/**
 * Family rules as versioned, effective-dated configuration — ADR 0011's
 * "family rules are stable domain knowledge and belong in code".
 *
 * Every number here was read off that family's own current offer page on
 * obligacjeskarbowe.pl, not carried over from secondary sources. That mattered:
 * the widely-repeated "0.70 zł for ROR/DOR, 2.00 zł for EDO" is wrong for
 * anything bought today — ROR is 0.50 zł, and EDO and ROD went to 3.00 zł for
 * issues purchased from 2024-09-01.
 *
 * Only the fee has ever moved, so the shape here is "one description of the
 * family, plus a dated fee timeline" rather than a full copy of the rules per
 * version. A second copy is how the tenor and the fee drift apart.
 */

const PLN = currency('PLN');

/** Before the Ministry's 2024 fee revision — earlier than any retail issue. */
const EPOCH = Temporal.PlainDate.from('1900-01-01');
const FEE_REVISION = Temporal.PlainDate.from('2024-09-01');

interface FamilyShape {
  readonly tenorMonths: number;
  readonly periodMonths: number;
  readonly capitalizes: boolean;
  readonly payout: PayoutSchedule;
  readonly indexId: IndexId | null;
  /**
   * Dated fee timeline, oldest first. OTS has none: it charges nothing and
   * forfeits the interest instead, which is a different rule, not a zero fee.
   */
  readonly earlyRedemption: readonly {
    readonly from: Temporal.PlainDate;
    readonly rule: EarlyRedemptionRule;
  }[];
}

const fee = (amount: string, capping: 'always' | 'first_period_only'): EarlyRedemptionRule => ({
  kind: 'fee',
  amountPerBond: Money.of(amount, PLN),
  capping,
});

const shapes: Record<BondFamily, FamilyShape> = {
  /**
   * Three-month fixed, one single interest period. The only family with no
   * early-redemption fee — and the only one where redeeming early costs you
   * *all* the interest instead ("odsetki nie zostaną naliczone").
   */
  OTS: {
    tenorMonths: 3,
    periodMonths: 3,
    capitalizes: false,
    payout: 'at_redemption',
    indexId: null,
    earlyRedemption: [{ from: EPOCH, rule: { kind: 'forfeit_interest' } }],
  },

  /** One year, monthly reset against the NBP reference rate, zero margin. */
  ROR: {
    tenorMonths: 12,
    periodMonths: 1,
    capitalizes: false,
    payout: 'monthly',
    indexId: 'nbp_reference',
    earlyRedemption: [{ from: EPOCH, rule: fee('0.50', 'first_period_only') }],
  },

  /** Two years, monthly reset against the NBP reference rate plus a margin. */
  DOR: {
    tenorMonths: 24,
    periodMonths: 1,
    capitalizes: false,
    payout: 'monthly',
    indexId: 'nbp_reference',
    earlyRedemption: [{ from: EPOCH, rule: fee('0.70', 'first_period_only') }],
  },

  /** Three years, fixed for the whole term, capitalized annually. */
  TOS: {
    tenorMonths: 36,
    periodMonths: 12,
    capitalizes: true,
    payout: 'at_redemption',
    indexId: null,
    earlyRedemption: [
      { from: EPOCH, rule: fee('0.70', 'always') },
      { from: FEE_REVISION, rule: fee('1.00', 'always') },
    ],
  },

  /** Four years, CPI-indexed, and the one indexed family that pays out annually. */
  COI: {
    tenorMonths: 48,
    periodMonths: 12,
    capitalizes: false,
    payout: 'annual',
    indexId: 'pl_cpi_yoy',
    earlyRedemption: [
      { from: EPOCH, rule: fee('0.70', 'first_period_only') },
      { from: FEE_REVISION, rule: fee('2.00', 'first_period_only') },
    ],
  },

  /** Six years, family ("rodzinne") bond, CPI-indexed and capitalized. */
  ROS: {
    tenorMonths: 72,
    periodMonths: 12,
    capitalizes: true,
    payout: 'at_redemption',
    indexId: 'pl_cpi_yoy',
    earlyRedemption: [
      { from: EPOCH, rule: fee('0.70', 'always') },
      { from: FEE_REVISION, rule: fee('2.00', 'always') },
    ],
  },

  /** Ten years, the retirement bond. CPI-indexed and capitalized. */
  EDO: {
    tenorMonths: 120,
    periodMonths: 12,
    capitalizes: true,
    payout: 'at_redemption',
    indexId: 'pl_cpi_yoy',
    earlyRedemption: [
      { from: EPOCH, rule: fee('2.00', 'always') },
      { from: FEE_REVISION, rule: fee('3.00', 'always') },
    ],
  },

  /** Twelve years, family bond. CPI-indexed and capitalized. */
  ROD: {
    tenorMonths: 144,
    periodMonths: 12,
    capitalizes: true,
    payout: 'at_redemption',
    indexId: 'pl_cpi_yoy',
    earlyRedemption: [
      { from: EPOCH, rule: fee('2.00', 'always') },
      { from: FEE_REVISION, rule: fee('3.00', 'always') },
    ],
  },
};

/**
 * The rules in force for a bond of this family bought on this date. Adding a
 * family is an entry in `shapes`; adding a *series* needs nothing at all, which
 * is the property ADR 0011 is protecting.
 */
export function resolveFamilyRules(
  family: BondFamily,
  purchasedOn: Temporal.PlainDate,
): BondFamilyRules {
  const shape = shapes[family];
  let inForce: { from: Temporal.PlainDate; rule: EarlyRedemptionRule } | undefined;
  for (const version of shape.earlyRedemption) {
    if (Temporal.PlainDate.compare(version.from, purchasedOn) <= 0) inForce = version;
  }
  if (inForce === undefined) {
    throw new Error(`No ${family} rules in force on ${purchasedOn.toString()}`);
  }

  return {
    family,
    effectiveFrom: inForce.from,
    tenorMonths: shape.tenorMonths,
    periodMonths: shape.periodMonths,
    capitalizes: shape.capitalizes,
    payout: shape.payout,
    indexId: shape.indexId,
    earlyRedemption: inForce.rule,
  };
}

/** Exposed so a test can assert every family in the vocabulary has a shape. */
export const bondFamilyShapes: Readonly<Record<BondFamily, FamilyShape>> = shapes;
export { bondFamilies };
