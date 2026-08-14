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
  readonly marketValueByCurrency: readonly Money[];
  /** Grouped by cost-basis currency — a USD position with a PLN-converted lot and a native-USD lot never gets summed into one blended figure. */
  readonly unrealizedByCurrency: readonly Money[];
}

export interface PositionsValuation {
  readonly positions: readonly ValuedPosition[];
  /** Every valuable open position's market value, converted to PLN and summed. */
  readonly totalMarketValuePln: Money;
  /** `false` when at least one open position couldn't be priced or converted — the total is a partial sum, not a wrong one. */
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
 */
export function valuePositions(
  positions: readonly InstrumentPosition[],
  prices: ReadonlyMap<InstrumentId, PriceLookup>,
  ratesToPln: ReadonlyMap<Currency, Decimal>,
): PositionsValuation {
  let totalMarketValuePln = Money.zero(PLN);
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

      const inPln = convertOrNull(marketValue, PLN, ratesToPln);
      if (inPln === null) {
        totalIsComplete = false;
      } else {
        totalMarketValuePln = totalMarketValuePln.plus(inPln);
      }

      const inCostBasisCurrency =
        marketValue.currency === line.costBasis.currency
          ? marketValue
          : convertOrNull(marketValue, line.costBasis.currency, ratesToPln);

      const unrealized =
        inCostBasisCurrency === null ? null : inCostBasisCurrency.minus(line.costBasis);

      return { ...line, marketValue, unrealized };
    });

    return {
      ...position,
      lines,
      marketValueByCurrency: groupByCurrency(
        lines.flatMap((line) => (line.marketValue === null ? [] : [line.marketValue])),
      ),
      unrealizedByCurrency: groupByCurrency(
        lines.flatMap((line) => (line.unrealized === null ? [] : [line.unrealized])),
      ),
    };
  });

  return { positions: valued, totalMarketValuePln, totalIsComplete };
}
