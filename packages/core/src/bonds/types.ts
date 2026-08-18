import type Decimal from 'decimal.js';
import { z } from 'zod';

import { type Money } from '../money';
import { type Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';

// The closed value lists live in `./vocabulary`, which imports nothing at all,
// for the reason its header gives. Re-exported here so every other caller sees
// one bonds module.
export * from './vocabulary';
import { bondFamilies, type BondFamily, type IndexId, type PayoutSchedule } from './vocabulary';

/**
 * A series code such as `EDO0836`: three letters of family, then the redemption
 * month and a two-digit redemption year. Branded because it is not any old
 * string — `parseSeriesCode` is the only way to get one, and it validates the
 * family against `bondFamilies`.
 */
export const bondSeriesCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}\d{4}$/)
  .brand<'BondSeriesCode'>();
export type BondSeriesCode = z.infer<typeof bondSeriesCodeSchema>;

/** What the series code decomposes into. The issue side is derived, not encoded. */
export interface ParsedSeriesCode {
  readonly code: BondSeriesCode;
  readonly family: BondFamily;
  /** The month and year the code names — a *label* for the redemption month. */
  readonly redemptionMonth: Temporal.PlainYearMonth;
}

/**
 * How a family behaves when the holder redeems early.
 *
 * Two genuinely different shapes, verified against each family's own offer page
 * on obligacjeskarbowe.pl rather than assumed to be uniform:
 *
 * - `forfeit_interest` — OTS only. No fee, but the holder gets back exactly the
 *   100 zł nominal and **no interest at all**.
 * - `fee` — everyone else. A flat per-bond amount deducted from accrued
 *   interest, with a capping rule that is *not* the same across families:
 *   - `always`: the fee never exceeds accrued interest (TOS, ROS, EDO, ROD).
 *   - `first_period_only`: capped at accrued interest during the first interest
 *     period, then taken in full out of the redemption amount even when that
 *     period's accrued interest is smaller (ROR, DOR, COI).
 */
export type EarlyRedemptionRule =
  | { readonly kind: 'forfeit_interest' }
  | {
      readonly kind: 'fee';
      readonly amountPerBond: Money;
      readonly capping: 'always' | 'first_period_only';
    };

/**
 * The stable, per-family half of a bond's behaviour (ADR 0011). Effective-dated
 * because these do change: the early-redemption fee moved for issues bought
 * from 2024-09-01, and versioning it is cheaper than discovering later that a
 * 2023 holding has been valued with a 2024 fee.
 */
export interface BondFamilyRules {
  readonly family: BondFamily;
  /** From which purchase date this version of the rules applies. */
  readonly effectiveFrom: Temporal.PlainDate;
  /** Total tenor. OTS is 3, ROR 12, ROD 144. */
  readonly tenorMonths: number;
  /**
   * The length of one interest period. This is what sets the periodic rate:
   * `periodRate = annualRate × periodMonths / 12`. ROR and DOR reset monthly
   * (1), OTS has a single three-month period (3), everyone else is annual (12).
   */
  readonly periodMonths: number;
  /** Whether a period's interest is added to the base the next period accrues on. */
  readonly capitalizes: boolean;
  readonly payout: PayoutSchedule;
  /** `null` for the fixed families (OTS, TOS), which never look at an index. */
  readonly indexId: IndexId | null;
  readonly earlyRedemption: EarlyRedemptionRule;
}

/**
 * A family's rules composed with one issue's own two published numbers. This is
 * what `bond_series_terms` caches and what the accrual engine actually reads.
 */
export interface BondTerms {
  readonly seriesCode: BondSeriesCode;
  readonly rules: BondFamilyRules;
  /**
   * The annualized rate for the **first** interest period, as a fraction —
   * 5.35% is `0.0535`, not `5.35`. Published per issue in the emission letter.
   */
  readonly firstPeriodRate: Decimal;
  /**
   * The annualized margin added to the index from the second period onward,
   * as a fraction. Zero for the fixed families.
   */
  readonly margin: Decimal;
}

/**
 * One holder's purchase. The **settlement date anchors every interest period**
 * — the Ministry's own interest tables are titled "NABYTYCH W DNIU <date>",
 * one table per purchase date, precisely because periods run from when *this
 * holder* bought rather than from when the series opened.
 */
export interface BondPurchase {
  readonly seriesCode: BondSeriesCode;
  readonly settledOn: Temporal.PlainDate;
  /** Whole bonds. Every retail series has a 100 PLN nominal per bond. */
  readonly quantity: number;
}

/**
 * An observation of a macro series, keyed by the date from which it may be
 * used. Uniform across both series so the "which value applies to this period"
 * lookup is one rule rather than two:
 *
 * - **NBP reference rate** — `effectiveFrom` is the rate's `obowiazuje_od`.
 * - **PL CPI year-on-year** — `effectiveFrom` is the first day of the month the
 *   figure was *announced* in, not the month it describes. The indexed families
 *   use "the rate announced in the month preceding the interest period", so
 *   dating by announcement is what makes that lookup a simple `< periodStart`.
 *
 * `value` is a fraction, not a percentage: 3.0% y/y is `0.03`.
 */
export interface IndexObservation {
  readonly indexId: IndexId;
  readonly effectiveFrom: Temporal.PlainDate;
  readonly value: Decimal;
}

/** One interest period of one holding, with the rate that applied to it. */
export interface BondInterestPeriod {
  /** 1-based, matching the "Okres odsetkowy: 1" on the published tables. */
  readonly ordinal: number;
  readonly startsOn: Temporal.PlainDate;
  readonly endsOn: Temporal.PlainDate;
  /** The annualized rate for this period, as a fraction. */
  readonly annualRate: Decimal;
  /** The amount this period accrues on — 100 zł, plus capitalized interest. */
  readonly base: Money;
  /** Interest earned across the whole period, rounded to the grosz. */
  readonly interest: Money;
}

/**
 * What a holding is worth on a given day. Mirrors `docs/domain.md`'s
 * `accrueBond` signature.
 *
 * Every amount is **gross**. Withholding is deliberately not applied here —
 * see `withholding.ts` for why the 19% belongs to the account, not the bond.
 */
export interface BondAccrual {
  readonly seriesCode: BondSeriesCode;
  readonly asOf: Temporal.PlainDate;
  /**
   * Face value held: quantity × 100 PLN — and **zero before settlement**, when
   * the money is still sitting in the cash leg and reporting a nominal here
   * would count it twice in a portfolio total.
   */
  readonly nominal: Money;
  /** Interest accrued and not yet paid out, rounded to the grosz. */
  readonly accruedInterest: Money;
  /** Interest already paid out to the holder (monthly and annual payers). */
  readonly paidInterest: Money;
  /** `nominal` plus capitalized interest plus `accruedInterest`. */
  readonly currentValue: Money;
  /** What redeeming today would actually pay, after the family's fee rule. */
  readonly earlyRedemptionValue: Money;
  /** The periods elapsed so far, newest last. Drives the cash-flow view later. */
  readonly periods: readonly BondInterestPeriod[];
  /**
   * Where these figures came from: the emission agent whose published table
   * was read, or `'computed'` when our own engine produced them. The user must
   * always be able to tell the Ministry's number from ours — they agree to the
   * grosz today, and the day they stop agreeing this field is what says which
   * one they are looking at.
   */
  readonly source: ProviderName | 'computed';
}

/** Gross and net, once a withholding rate is known. See `withholding.ts`. */
export interface WithheldAmount {
  readonly gross: Money;
  readonly tax: Money;
  readonly net: Money;
}

export const isBondFamily = (value: string): value is BondFamily =>
  (bondFamilies as readonly string[]).includes(value);
