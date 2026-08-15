import { type Wrapper } from '../ledger/vocabulary';
import { currency as toCurrency, Money } from '../money';
import { type Temporal } from '../time';

/**
 * Per-wrapper, per-year contribution limits and tax treatment.
 *
 * `docs/domain.md` puts these in a `wrapper_rules` table keyed by
 * `(wrapper, year)` so "adding OKI in 2027 is rows, not code". This module is
 * the **domain shape** of such a row plus the arithmetic over it — the table
 * and its seed land with the screen that needs them. Defining the port and the
 * rules first keeps the limit check out of the UI, which is where it would
 * otherwise end up as an inline constant.
 */

const PLN = toCurrency('PLN');

export interface WrapperRules {
  readonly wrapper: Wrapper;
  readonly year: number;
  /**
   * Maximum a holder may pay in during `year`. `null` where the wrapper has no
   * cap at all — a plain brokerage account — which is a different statement
   * from a cap of zero and must not collapse into one.
   */
  readonly contributionLimit: Money | null;
  /**
   * Whether gains inside the wrapper escape the 19% flat tax. IKE and IKZE do,
   * on different conditions; a brokerage account does not. This is what
   * `withholdingOn`'s rate argument should be derived from rather than
   * hard-coding 19% at the call site.
   */
  readonly taxExempt: boolean;
}

export interface ContributionRoom {
  readonly wrapper: Wrapper;
  readonly year: number;
  readonly limit: Money | null;
  readonly contributed: Money;
  /** `null` when the wrapper is uncapped — not zero, which would read as "full". */
  readonly remaining: Money | null;
  readonly isExceeded: boolean;
}

export class UnknownWrapperRulesError extends Error {
  constructor(wrapper: Wrapper, year: number) {
    super(
      `No ${wrapper} rules are on file for ${year} — limits change annually and must be entered, never extrapolated from the previous year`,
    );
    this.name = 'UnknownWrapperRulesError';
  }
}

/**
 * How much room is left in a wrapper this year.
 *
 * Deliberately **refuses** rather than falling back to last year's figure when
 * the year is missing. The IKE limit moves every year with average earnings;
 * carrying forward a stale one would tell a user they have room they do not
 * have, and an over-contribution is a problem with the tax office rather than
 * with this app.
 */
export function contributionRoomFor(
  rules: readonly WrapperRules[],
  wrapper: Wrapper,
  year: number,
  contributed: Money,
): ContributionRoom {
  const match = rules.find((rule) => rule.wrapper === wrapper && rule.year === year);
  if (match === undefined) throw new UnknownWrapperRulesError(wrapper, year);

  if (match.contributionLimit === null) {
    return { wrapper, year, limit: null, contributed, remaining: null, isExceeded: false };
  }

  const remaining = match.contributionLimit.minus(contributed);
  return {
    wrapper,
    year,
    limit: match.contributionLimit,
    contributed,
    // Clamped at zero: "you are 400 zł over" is carried by `isExceeded`, and a
    // negative "remaining" reads as room in the wrong direction.
    remaining: remaining.isNegative() ? Money.zero(contributed.currency) : remaining,
    isExceeded: remaining.isNegative(),
  };
}

/** The withholding rate a wrapper implies, for `withholdingOn`. */
export function isTaxExempt(
  rules: readonly WrapperRules[],
  wrapper: Wrapper,
  year: number,
): boolean {
  const match = rules.find((rule) => rule.wrapper === wrapper && rule.year === year);
  if (match === undefined) throw new UnknownWrapperRulesError(wrapper, year);
  return match.taxExempt;
}

/**
 * The rules we can state as fact, as the seed for `wrapper_rules`.
 *
 * **The IKE and IKZE caps are deliberately absent.** They are announced each
 * year by the Minister for Social Policy — IKE at 3× and IKZE at 1.2× (1.8×
 * for the self-employed) the forecast average monthly wage — and I could not
 * reach an official figure for them, so there is nothing here to write down.
 * Filling them from memory is precisely the mistake that took the whole CPI
 * series down in #38: a remembered number that looks authoritative and is not.
 *
 * `contributionRoomFor` therefore raises `UnknownWrapperRulesError` for an IKE
 * or IKZE year until someone enters the announced figure with its source. That
 * is the intended behaviour, not a gap: a limit check that silently passes is
 * worse than one that admits it does not know, because an over-contribution is
 * a problem with the tax office rather than with this app.
 *
 * A brokerage account is a different matter — it has no cap and no exemption by
 * definition, not by announcement, so it is stated here.
 */
export const publishedWrapperRules: readonly WrapperRules[] = [
  { wrapper: 'brokerage', year: 2026, contributionLimit: null, taxExempt: false },
];

/** Contributions counted for a limit are the deposits made within the calendar year. */
export function yearOf(date: Temporal.PlainDate): number {
  return date.year;
}

export { PLN as wrapperLimitCurrency };
