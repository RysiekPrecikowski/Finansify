import { type Wrapper } from '../ledger/vocabulary';
import { currency as toCurrency, Money } from '../money';
import { type Temporal } from '../time';

/**
 * Per-wrapper, per-year contribution limits and tax treatment.
 *
 * `docs/domain.md` puts these in a `wrapper_rules` table keyed by
 * `(wrapper, year)` so "adding OKI in 2027 is rows, not code". This module is
 * the **domain shape** of such a row plus the arithmetic over it; the seed
 * below is what the table gets loaded with.
 */

const PLN = toCurrency('PLN');

/**
 * Whether the holder pays IKZE's higher self-employed limit.
 *
 * IKZE has **two** caps, not one — 1.8× the forecast average wage for people
 * running a non-agricultural business and 1.2× for everyone else. Modelling it
 * as a single number would silently under-report room for one group and
 * over-report it for the other, which is the more dangerous direction.
 * Everything except IKZE ignores this.
 */
export type ContributionStatus = 'standard' | 'self_employed';

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
   * IKZE's higher cap for the self-employed. `null` everywhere else, and for
   * IKZE years before 2021, when a single limit applied to everyone.
   */
  readonly selfEmployedLimit: Money | null;
  /**
   * Whether gains inside the wrapper escape the 19% flat tax. IKE and IKZE do,
   * on different conditions; a brokerage account does not. This is what
   * `withholdingOn`'s rate argument should be derived from rather than
   * hard-coding 19% at the call site.
   */
  readonly taxExempt: boolean;
  /**
   * Where the figure came from. Not decoration: the one time these were filled
   * in from memory the numbers were a full year stale, and a row without a
   * citation is indistinguishable from a row with a guess in it.
   */
  readonly source: string;
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
      `No ${wrapper} rules are on file for ${year} — limits change annually and must be entered from the published announcement, never extrapolated from the previous year`,
    );
    this.name = 'UnknownWrapperRulesError';
  }
}

function ruleFor(rules: readonly WrapperRules[], wrapper: Wrapper, year: number): WrapperRules {
  const match = rules.find((rule) => rule.wrapper === wrapper && rule.year === year);
  if (match === undefined) throw new UnknownWrapperRulesError(wrapper, year);
  return match;
}

/**
 * How much room is left in a wrapper this year.
 *
 * Deliberately **refuses** rather than falling back to last year's figure when
 * the year is missing. These limits move every year with the forecast average
 * wage; carrying a stale one forward would tell a user they have room they do
 * not have, and an over-contribution is a problem with the tax office rather
 * than with this app.
 */
export function contributionRoomFor(
  rules: readonly WrapperRules[],
  wrapper: Wrapper,
  year: number,
  contributed: Money,
  status: ContributionStatus = 'standard',
): ContributionRoom {
  const rule = ruleFor(rules, wrapper, year);

  const limit =
    status === 'self_employed' && rule.selfEmployedLimit !== null
      ? rule.selfEmployedLimit
      : rule.contributionLimit;

  if (limit === null) {
    return { wrapper, year, limit: null, contributed, remaining: null, isExceeded: false };
  }

  const remaining = limit.minus(contributed);
  return {
    wrapper,
    year,
    limit,
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
  return ruleFor(rules, wrapper, year).taxExempt;
}

const KNF_IKE = 'KNF, knf.gov.pl/?articleId=81021&p_id=18 (retrieved 2026-08-15)';
const KNF_IKZE = 'KNF, knf.gov.pl/?articleId=81022&p_id=18 (retrieved 2026-08-15)';

const ike = (year: number, limit: string): WrapperRules => ({
  wrapper: 'ike',
  year,
  contributionLimit: Money.of(limit, PLN),
  selfEmployedLimit: null,
  taxExempt: true,
  source: KNF_IKE,
});

const ikze = (year: number, standard: string, selfEmployed: string | null): WrapperRules => ({
  wrapper: 'ikze',
  year,
  contributionLimit: Money.of(standard, PLN),
  selfEmployedLimit: selfEmployed === null ? null : Money.of(selfEmployed, PLN),
  taxExempt: true,
  source: KNF_IKZE,
});

/**
 * The published limits, as the seed for `wrapper_rules`.
 *
 * Every figure is transcribed from the KNF's own tables, which carry the
 * `Monitor Polski` reference for each year — IKE at 3× and IKZE at 1.2×
 * (1.8× for the self-employed) the forecast average monthly wage.
 *
 * Seven years back, which covers any holding this app can currently value and
 * both sides of IKZE's 2021 split into two limits. Earlier years are published
 * and can be added the same way; they are absent because nothing needs them
 * yet, not because they are unknown.
 *
 * **`brokerage` and `ppk` carry no cap.** For a brokerage account that is true
 * by definition. PPK's contributions are a percentage of salary set by the
 * employer rather than an annual ceiling the holder can breach, so a limit here
 * would be modelling the wrong thing — `null` says "this is not a capped
 * wrapper", which is the honest answer.
 */
export const publishedWrapperRules: readonly WrapperRules[] = [
  ike(2026, '28260'),
  ike(2025, '26019'),
  ike(2024, '23472'),
  ike(2023, '20805'),
  ike(2022, '17766'),
  ike(2021, '15777'),
  ike(2020, '15681'),

  // The self-employed limit appears from 2021; before that one figure applied
  // to everyone, which is why the second argument is null for 2020.
  ikze(2026, '11304', '16956'),
  ikze(2025, '10407.60', '15611.40'),
  ikze(2024, '9388.80', '14083.20'),
  ikze(2023, '8322', '12483'),
  ikze(2022, '7106.40', '10659.60'),
  ikze(2021, '6310.80', '9466.20'),
  ikze(2020, '6272.40', null),

  ...[2020, 2021, 2022, 2023, 2024, 2025, 2026].flatMap<WrapperRules>((year) => [
    {
      wrapper: 'brokerage',
      year,
      contributionLimit: null,
      selfEmployedLimit: null,
      taxExempt: false,
      source: 'No cap and no exemption by definition',
    },
    {
      wrapper: 'ppk',
      year,
      contributionLimit: null,
      selfEmployedLimit: null,
      taxExempt: true,
      source: 'Contributions are a share of salary, not an annual ceiling',
    },
  ]),
];

/** Contributions counted for a limit are the deposits made within the calendar year. */
export function yearOf(date: Temporal.PlainDate): number {
  return date.year;
}

export { PLN as wrapperLimitCurrency };
