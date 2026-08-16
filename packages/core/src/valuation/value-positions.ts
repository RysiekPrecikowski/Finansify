import type Decimal from 'decimal.js';

import { type InstrumentId } from '../ledger/types';
import { currency, Money, type Currency } from '../money';
import {
  groupByCurrency,
  type AccountPositionLine,
  type InstrumentPosition,
} from '../usecases/list-positions';
import { convertViaPln, UnknownFxRateError } from './convert';
import { type PriceLookup } from './types';

const PLN = currency('PLN');

export interface ValuedAccountLine extends AccountPositionLine {
  /** In the instrument's own currency — `null` when no price is on file at all. */
  readonly marketValue: Money | null;
  /**
   * In this line's **cost-basis currency** (never the instrument's), so it
   * reads directly against `costBasis` with no rate applied by the caller.
   * `null` when there's no price, or no FX rate to bridge instrument currency
   * to cost-basis currency — never an invented number standing in for either.
   */
  readonly unrealized: Money | null;
}

export interface ValuedPosition extends InstrumentPosition {
  readonly lines: readonly ValuedAccountLine[];
  /**
   * In `display.lines` when that names a currency, otherwise one entry per
   * instrument currency. A currency the rates can't reach is left out rather
   * than substituted (rule 7), which is why this can be empty for a position
   * that does have a price.
   */
  readonly marketValueByCurrency: readonly Money[];
  /** Grouped by cost-basis currency — a USD position with a PLN-converted lot and a native-USD lot never gets summed into one blended figure. */
  readonly unrealizedByCurrency: readonly Money[];
}

/**
 * What the reader chose to look at, which is not what the ledger recorded. The
 * two settings are independent on purpose: the useful default is a total in
 * one's own currency over positions still shown in theirs, and collapsing them
 * into one control would take that away.
 */
export interface DisplayCurrencies {
  /** The currency the portfolio total is summed in. */
  readonly total: Currency;
  /** `'native'` leaves each position in its instrument's currency. */
  readonly lines: Currency | 'native';
}

export interface PositionsValuation {
  readonly positions: readonly ValuedPosition[];
  /** Every valuable open position's market value, converted to `display.total` and summed. */
  readonly totalMarketValue: Money;
  /** `false` when at least one open position couldn't be priced or converted into `display.total` — the total is a partial sum, not a wrong one. */
  readonly totalIsComplete: boolean;
}

/** `null` on a missing rate rather than throwing — a stray currency shouldn't blank the whole valuation. */
function convertOrNull(
  amount: Money,
  toCurrency: Currency,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
): Money | null {
  try {
    return convertViaPln(amount, toCurrency, ratesToPln);
  } catch (error) {
    if (error instanceof UnknownFxRateError) return null;
    throw error;
  }
}

/**
 * Pure valuation over positions already built by `buildPositions` — no I/O, no
 * `Instant.now()`, just `PriceLookup`s and FX rates the caller already fetched.
 * Unrealized P&L lands in **cost-basis currency**, not the instrument's: a PLN
 * account holding a USD ETF sees its gain in PLN, matching what the broker
 * statement already shows, rather than a USD figure nobody's account is
 * actually denominated in.
 *
 * `display` moves the *presentation* only. Unrealized P&L stays in cost-basis
 * currency and realized P&L is passed through untouched, whatever the reader
 * picked — a display choice that silently restated either would be reporting a
 * different number for the same history.
 *
 * `display` has no default: this used to assume PLN, and a default would keep
 * that assumption alive in exactly the callers that forgot to think about it.
 */
export function valuePositions(
  positions: readonly InstrumentPosition[],
  prices: ReadonlyMap<InstrumentId, PriceLookup>,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
  display: DisplayCurrencies,
): PositionsValuation {
  const lineCurrency = display.lines;
  let totalMarketValue = Money.zero(display.total);
  let totalIsComplete = true;

  const valued = positions.map((position): ValuedPosition => {
    const price = prices.get(position.instrument.id);
    const hasPrice = price !== undefined && price.status !== 'unavailable';

    const lines = position.lines.map((line): ValuedAccountLine => {
      if (!hasPrice) {
        if (!line.quantity.isZero()) totalIsComplete = false;
        return { ...line, marketValue: null, unrealized: null };
      }

      const marketValue = price.close.times(line.quantity);

      const inTotalCurrency = convertOrNull(marketValue, display.total, ratesToPln);
      if (inTotalCurrency === null) {
        totalIsComplete = false;
      } else {
        totalMarketValue = totalMarketValue.plus(inTotalCurrency);
      }

      const inCostBasisCurrency =
        marketValue.currency === line.costBasis.currency
          ? marketValue
          : convertOrNull(marketValue, line.costBasis.currency, ratesToPln);

      const unrealized =
        inCostBasisCurrency === null ? null : inCostBasisCurrency.minus(line.costBasis);

      return { ...line, marketValue, unrealized };
    });

    // `line.marketValue` stays in the instrument's currency whatever the reader
    // picked — it is the raw fact, and the display choice applies to the
    // aggregate the UI actually renders.
    const marketValues = lines.flatMap((line) =>
      line.marketValue === null ? [] : [line.marketValue],
    );

    return {
      ...position,
      lines,
      marketValueByCurrency: groupByCurrency(
        lineCurrency === 'native'
          ? marketValues
          : marketValues.flatMap((amount) => {
              const converted = convertOrNull(amount, lineCurrency, ratesToPln);
              return converted === null ? [] : [converted];
            }),
      ),
      unrealizedByCurrency: groupByCurrency(
        lines.flatMap((line) => (line.unrealized === null ? [] : [line.unrealized])),
      ),
    };
  });

  return { positions: valued, totalMarketValue, totalIsComplete };
}
