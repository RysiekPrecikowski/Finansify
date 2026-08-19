import Decimal from 'decimal.js';

import { type InstrumentId, type Transaction } from '../ledger/types';
import { Money, currency, type Currency } from '../money';
import {
  chronologically,
  closingTypes,
  openingTypes,
  UnsupportedTransactionTypeError,
} from '../positions/build-positions';
import { Temporal } from '../time';
import { type FxRate, type PriceBar, type SeriesGrain } from './types';

const PLN = currency('PLN');
const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * One day's total, positions-only (no cash — decision 4 of CU-869ej7zk8's
 * plan). `unpriced` names every instrument that was **held** on this date but
 * could not be valued or converted; a fully-exited instrument is never in it,
 * because it was never looked up (rule 7 — nothing here is ever guessed).
 */
export interface ValuePoint {
  readonly date: Temporal.PlainDate;
  readonly value: Money;
  readonly status: 'complete' | 'partial';
  readonly unpriced: readonly InstrumentId[];
}

/**
 * The dates a chart actually samples, at one of three cadences. `from` and
 * `to` are always the first and last entries — `to` is appended even when it
 * lands mid-bucket, which is what keeps the series' last point equal to
 * *today*, whatever grain was requested.
 *
 * `week`/`month` buckets are anchored at `from`, not at a calendar boundary
 * (an ISO Monday, the 1st of the month): nothing downstream needs calendar
 * alignment, and anchoring at `from` is what makes "the last entry is always
 * `to`" true without a special case.
 */
export function sampleDates(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  grain: SeriesGrain,
): readonly Temporal.PlainDate[] {
  if (from.equals(to)) return [from];

  if (grain === 'day') {
    const dates: Temporal.PlainDate[] = [];
    for (
      let cursor = from;
      Temporal.PlainDate.compare(cursor, to) <= 0;
      cursor = cursor.add({ days: 1 })
    ) {
      dates.push(cursor);
    }
    return dates;
  }

  const step = grain === 'week' ? { days: 7 } : { months: 1 };
  const dates: Temporal.PlainDate[] = [from];
  for (
    let cursor = from.add(step);
    Temporal.PlainDate.compare(cursor, to) < 0;
    cursor = cursor.add(step)
  ) {
    dates.push(cursor);
  }
  if (!dates.at(-1)!.equals(to)) dates.push(to);
  return dates;
}

/**
 * Carries the last value at or before a requested date forward, per key —
 * the shared shape behind both the price and the FX lookup below. Cursors
 * only ever move forward because the outer walk over `dates` is ascending and
 * every series handed in is ascending too (the ports' own contract), so this
 * is one amortized pass over each series rather than a search per date.
 */
function makeCarryForward<K, T>(dateOf: (item: T) => Temporal.PlainDate) {
  const cursors = new Map<K, { index: number; last: T | undefined }>();

  return function advance(key: K, series: readonly T[], date: Temporal.PlainDate): T | undefined {
    let state = cursors.get(key);
    if (state === undefined) {
      state = { index: 0, last: undefined };
      cursors.set(key, state);
    }
    while (
      state.index < series.length &&
      Temporal.PlainDate.compare(dateOf(series[state.index]!), date) <= 0
    ) {
      state.last = series[state.index];
      state.index += 1;
    }
    return state.last;
  };
}

/**
 * Reconstructs the portfolio's market value on each of `dates`, folding the
 * ledger forward exactly once (both the transaction walk and every price/FX
 * series are ascending, so nothing here re-scans).
 *
 * A missing price or FX rate never blanks the point or interpolates one in
 * (rule 7) — it drops that one holding from the sum, lists its instrument in
 * `unpriced`, and marks the whole point `partial`. The last point of the
 * series is meant to agree with `valuePositions`' `totalMarketValue` given the
 * same "today" prices and rates; that parity is what keeps the chart honest
 * against the dashboard headline.
 *
 * `split` throws rather than guessing an adjustment factor, the same stance
 * `buildPositions` takes — a chart drawn through an un-adjusted split would be
 * a wrong number that looks plausible, which is worse than no chart.
 */
export function portfolioValueSeries(input: {
  readonly dates: readonly Temporal.PlainDate[];
  readonly transactions: readonly Transaction[];
  readonly priceHistory: ReadonlyMap<InstrumentId, readonly PriceBar[]>;
  readonly fxHistory: ReadonlyMap<Currency, readonly FxRate[]>;
  readonly bondUnitValues: ReadonlyMap<InstrumentId, ReadonlyMap<string, Money>>;
  readonly instrumentCurrency: ReadonlyMap<InstrumentId, Currency>;
  readonly presentIn: Currency;
}): readonly ValuePoint[] {
  const { dates, priceHistory, fxHistory, bondUnitValues, instrumentCurrency, presentIn } = input;

  const sortedTransactions = [...input.transactions].sort(chronologically);
  for (const transaction of sortedTransactions) {
    if (transaction.type === 'split') throw new UnsupportedTransactionTypeError(transaction.type);
  }

  const advancePrice = makeCarryForward<InstrumentId, PriceBar>((bar) => bar.date);
  const advanceFx = makeCarryForward<Currency, FxRate>((rate) => rate.date);

  /** Units-to-PLN at or before `date`, `null` when no rate has been published yet. */
  function rateToPlnAt(code: Currency, date: Temporal.PlainDate): Decimal | null {
    if (code === PLN) return ONE;
    const rate = advanceFx(code, fxHistory.get(code) ?? [], date);
    return rate?.mid ?? null;
  }

  function convertAt(amount: Money, toCurrency: Currency, date: Temporal.PlainDate): Money | null {
    if (amount.currency === toCurrency) return amount;
    const fromRate = rateToPlnAt(amount.currency, date);
    const toRate = rateToPlnAt(toCurrency, date);
    if (fromRate === null || toRate === null) return null;
    const inPln = amount.amount.times(fromRate);
    const converted = toCurrency === PLN ? inPln : inPln.dividedBy(toRate);
    return Money.of(converted, toCurrency);
  }

  const quantities = new Map<InstrumentId, Decimal>();
  let txIndex = 0;

  return dates.map((date): ValuePoint => {
    while (
      txIndex < sortedTransactions.length &&
      Temporal.PlainDate.compare(sortedTransactions[txIndex]!.tradeDate, date) <= 0
    ) {
      const transaction = sortedTransactions[txIndex]!;
      txIndex += 1;
      if (transaction.instrumentId === null) continue;

      if (openingTypes.has(transaction.type)) {
        const held = quantities.get(transaction.instrumentId) ?? ZERO;
        quantities.set(transaction.instrumentId, held.plus(transaction.quantity));
      } else if (closingTypes.has(transaction.type)) {
        const held = quantities.get(transaction.instrumentId) ?? ZERO;
        quantities.set(transaction.instrumentId, held.minus(transaction.quantity));
      }
      // Cash-only types (deposit, withdrawal, dividend, interest, coupon, fee,
      // tax) never move a unit count — this chart is positions-only.
    }

    let value = Money.zero(presentIn);
    let partial = false;
    const unpriced: InstrumentId[] = [];

    for (const [instrumentId, quantity] of quantities) {
      // `Decimal#isPositive()` treats zero as positive (its sign is `+1` by
      // convention) — the same footgun `Money#isPositive()` guards against
      // elsewhere in `core`. A fully exited holding must never be looked up.
      if (!quantity.greaterThan(0)) continue;

      const unitValue = bondUnitValues.has(instrumentId)
        ? bondUnitValues.get(instrumentId)!.get(date.toString())
        : advancePrice(instrumentId, priceHistory.get(instrumentId) ?? [], date)?.close;

      if (unitValue === undefined) {
        unpriced.push(instrumentId);
        partial = true;
        continue;
      }

      const marketValue = unitValue.times(quantity);
      // `instrumentCurrency` is the declared source of truth for what an
      // instrument is priced in — it only ever disagrees with the bar/bond
      // value's own currency if the caller mis-assembled its inputs, and
      // treating the declared currency as authoritative surfaces that as a
      // currency-mismatch failure inside `convertAt` rather than a silently
      // blended total.
      const instrumentCcy = instrumentCurrency.get(instrumentId) ?? marketValue.currency;
      const priced =
        instrumentCcy === marketValue.currency
          ? marketValue
          : Money.of(marketValue.amount, instrumentCcy);

      const converted = convertAt(priced, presentIn, date);
      if (converted === null) {
        unpriced.push(instrumentId);
        partial = true;
        continue;
      }

      value = value.plus(converted);
    }

    return { date, value, status: partial ? 'partial' : 'complete', unpriced };
  });
}
