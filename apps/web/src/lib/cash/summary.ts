import {
  convertViaPln,
  Money,
  UnknownFxRateError,
  type CashBalanceLine,
  type Currency,
  type ValuedPosition,
} from '@finansify/core';
import type Decimal from 'decimal.js';

/**
 * `/cash`'s derived figures.
 *
 * **Not a demo layer.** Unlike `/allocation`, this screen has real prior art:
 * `buildCashBalances` already produces one balance per `(account, currency)`
 * and `/portfolio` already renders them. Everything here is a fixed-point
 * computation over that same read model plus the FX rates the valuation
 * pipeline already fetched — no second, parallel source of cash.
 *
 * The one genuinely new derivation is **currency exposure**, and it lives in
 * `apps/web` rather than `packages/core` for the same reason the dashboard's
 * synthetic pieces do: there is no `getCurrencyExposure` use case, this is a
 * regrouping of numbers the caller already holds rather than new business
 * logic, and inventing a port for it would fix a shape before anything has
 * asked for one.
 *
 * Every figure below is computed from the same two inputs, so the page cannot
 * disagree with itself: the total equals the sum of the rows it lists, and the
 * share of portfolio uses the valuation's own total rather than a number copied
 * off a screenshot.
 */

/** `null` on a missing rate rather than throwing — a stray currency shouldn't blank the page (same stance as `lib/dashboard/snapshot.ts`). */
function convertOrNull(
  amount: Money,
  to: Currency,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
): Money | null {
  try {
    return convertViaPln(amount, to, ratesToPln);
  } catch (error) {
    if (error instanceof UnknownFxRateError) return null;
    throw error;
  }
}

export interface CashRow {
  readonly accountId: string;
  readonly accountName: string;
  readonly wrapper: CashBalanceLine['account']['wrapper'];
  /** The balance exactly as the ledger holds it, in the account's own currency. */
  readonly amount: Money;
  /**
   * What one unit of `amount.currency` is worth in the presentation currency.
   * `null` when the two are the same currency — there is no rate to show, and
   * `1,0000` would imply a conversion that never happened.
   */
  readonly rate: Money | null;
  /** The balance in the presentation currency. `null` when same-currency (nothing to convert) or when no rate exists. */
  readonly converted: Money | null;
}

export interface CashSummary {
  readonly rows: readonly CashRow[];
  /** Every balance converted to the presentation currency and summed. */
  readonly total: Money;
  /** `false` when at least one balance had no rate — the total is then a partial sum (rule 7). */
  readonly totalIsComplete: boolean;
  /** How many distinct currencies cash is actually held in. */
  readonly currencyCount: number;
}

export function buildCashSummary(
  cash: readonly CashBalanceLine[],
  ratesToPln: ReadonlyMap<Currency, Decimal>,
  presentation: Currency,
): CashSummary {
  let total = Money.zero(presentation);
  let totalIsComplete = true;

  const rows = cash.map((line): CashRow => {
    const sameCurrency = line.amount.currency === presentation;
    const converted = sameCurrency
      ? line.amount
      : convertOrNull(line.amount, presentation, ratesToPln);

    if (converted === null) totalIsComplete = false;
    else total = total.plus(converted);

    return {
      accountId: line.account.id,
      accountName: line.account.name,
      wrapper: line.account.wrapper,
      amount: line.amount,
      // The rate is the conversion of one whole unit, so it stays correct for
      // any presentation currency rather than only for PLN.
      rate: sameCurrency
        ? null
        : convertOrNull(Money.of('1', line.amount.currency), presentation, ratesToPln),
      converted: sameCurrency ? null : converted,
    };
  });

  return {
    rows,
    total,
    totalIsComplete,
    currencyCount: new Set(cash.map((line) => line.amount.currency)).size,
  };
}

/**
 * Cash as a share of the whole portfolio, or `null` when the question has no
 * sensible answer.
 *
 * Two cases return `null`, and both are reachable with an ordinary ledger:
 *
 * - **Negative cash.** A settled buy with no matching deposit recorded, an
 *   unsettled trade, or fees drawn against an empty account all leave the
 *   balance below zero. A negative *share of a portfolio* is not a fact about
 *   anything; the balance itself is shown above and says what happened.
 * - **A non-positive total.** Once the negative cash is added back, the
 *   denominator can collapse toward zero — the real test account sits at 514 zł
 *   of positions against −500 zł of cash, which produced a headline reading
 *   "−3546,10%". Arithmetically correct, and meaningless.
 *
 * Rule 7 applied to a ratio: show nothing rather than a number that is wrong in
 * the only sense a reader cares about.
 */
export function cashShareOfPortfolio(cashTotal: Money, portfolioTotal: Money): string | null {
  if (cashTotal.isNegative() || !portfolioTotal.isPositive()) return null;
  return cashTotal.amount.dividedBy(portfolioTotal.amount).toFixed(6);
}

export interface ExposureSlice {
  readonly currency: Currency;
  /** The exposure converted to the presentation currency. */
  readonly value: Money;
  /** Share of the whole portfolio, `'0'`–`'1'` as a decimal string. */
  readonly share: string;
}

/**
 * What share of the **whole portfolio** — not just its cash — sits in each
 * currency.
 *
 * Grouped by the currency each holding is actually denominated in, which is
 * why the caller must value positions with `lines: 'native'`: an instrument
 * bought in dollars is dollar exposure however the reader chooses to *read*
 * the total, and grouping the already-converted figures would report one
 * currency for everything and answer nothing.
 */
export function buildCurrencyExposure(
  positions: readonly ValuedPosition[],
  cash: readonly CashBalanceLine[],
  ratesToPln: ReadonlyMap<Currency, Decimal>,
  presentation: Currency,
): { readonly slices: readonly ExposureSlice[]; readonly total: Money } {
  const native = new Map<Currency, Money>();

  const add = (amount: Money) => {
    const running = native.get(amount.currency);
    native.set(amount.currency, running === undefined ? amount : running.plus(amount));
  };

  for (const position of positions) for (const value of position.marketValueByCurrency) add(value);
  for (const line of cash) add(line.amount);

  let total = Money.zero(presentation);
  const converted: { currency: Currency; value: Money }[] = [];

  for (const [currency, amount] of native) {
    const inPresentation =
      currency === presentation ? amount : convertOrNull(amount, presentation, ratesToPln);
    // A currency with no rate is left out rather than counted at an invented
    // one; the exposure bar then describes what it could actually price.
    if (inPresentation === null) continue;
    converted.push({ currency, value: inPresentation });
    total = total.plus(inPresentation);
  }

  const slices = converted
    .map(({ currency, value }) => ({
      currency,
      value,
      share: total.isZero() ? '0' : value.amount.dividedBy(total.amount).toFixed(6),
    }))
    .sort((left, right) => Number(right.share) - Number(left.share));

  return { slices, total };
}

/**
 * Which step of a neutral ramp a slice takes, spread across the **whole** ramp
 * rather than walking it from one end.
 *
 * Two categories otherwise land on two adjacent steps and read as one colour.
 * Same reasoning the sector-breakdown ramp already applies, generalised: the
 * first slice takes step 0, the last takes the last step, and everything
 * between is spaced evenly.
 */
export function rampIndex(index: number, count: number, steps: number): number {
  if (count <= 1) return 0;
  return Math.round((index * (steps - 1)) / (count - 1));
}
