import Decimal from 'decimal.js';

/** A `Stock purchase`/`Stock sell` row's raw trade facts, before any FX judgment. */
export interface TradeObservation {
  readonly ticker: string;
  /** This row's own fill quantity (from the comment grammar). */
  readonly quantity: Decimal;
  /** This row's own per-unit price (from the comment grammar). */
  readonly price: Decimal;
  /** `|Amount|` — the cash the statement actually reports for this row. */
  readonly amount: Decimal;
}

/**
 * Ratios within this of 1 count as "same currency" — a broker-side rounding
 * grosz on an otherwise unconverted trade should never read as an FX
 * conversion.
 */
const SAME_CURRENCY_TOLERANCE = new Decimal('0.005');

function median(values: readonly Decimal[]): Decimal {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2);
}

/**
 * Per-ticker median of `amount ÷ (quantity × price)` across every trade
 * observed for that ticker in the statement.
 *
 * XTB's export carries no explicit FX-rate column, so this ratio is the only
 * signal available — and a single row's ratio can be thrown off by ordinary
 * rounding, which is why this takes the median across every fill of the same
 * ticker rather than trusting one row. Verified against real exports: the
 * same USD-denominated instrument reads a ratio ≈1.0 from a USD account and
 * ≈0.90–0.98 from a EUR account holding the same position — that spread is
 * the FX conversion, not noise, and a median across repeated fills is what
 * separates the two reliably.
 *
 * A ticker whose median lands within `SAME_CURRENCY_TOLERANCE` of 1 maps to
 * `null` — no FX rate to report, `ParsedRow.fxRate` stays `null` for it.
 */
export function inferFxRatios(
  observations: readonly TradeObservation[],
): ReadonlyMap<string, Decimal | null> {
  const ratiosByTicker = new Map<string, Decimal[]>();

  for (const observation of observations) {
    if (observation.quantity.isZero() || observation.price.isZero()) continue;
    const ratio = observation.amount.dividedBy(observation.quantity.times(observation.price));
    const ratios = ratiosByTicker.get(observation.ticker);
    if (ratios === undefined) ratiosByTicker.set(observation.ticker, [ratio]);
    else ratios.push(ratio);
  }

  const result = new Map<string, Decimal | null>();
  for (const [ticker, ratios] of ratiosByTicker) {
    const ratio = median(ratios);
    const isSameCurrency = ratio.minus(1).abs().lessThanOrEqualTo(SAME_CURRENCY_TOLERANCE);
    result.set(ticker, isSameCurrency ? null : ratio);
  }
  return result;
}
