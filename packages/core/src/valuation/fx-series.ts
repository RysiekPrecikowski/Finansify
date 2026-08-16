import Decimal from 'decimal.js';

import { type Currency } from '../money';
import { Temporal } from '../time';
import { type FxRateProvider, type FxRateRepository } from './ports';
import { type FxRate } from './types';

export class SameCurrencyPairError extends Error {
  constructor(code: Currency) {
    super(`${code}/${code} is not a pair`);
    this.name = 'SameCurrencyPairError';
  }
}

/** `base` is what is being priced, `quote` is what it is priced in — USD/PLN is `{ base: USD, quote: PLN }`. */
export interface CurrencyPair {
  readonly base: Currency;
  readonly quote: Currency;
}

export interface FxSeriesPoint {
  readonly date: Temporal.PlainDate;
  /** Units of `quote` per one `base`. */
  readonly rate: Decimal;
}

export interface FxSeriesSummary {
  readonly pair: CurrencyPair;
  readonly latest: FxSeriesPoint;
  /** The publication before it, if the window holds one. */
  readonly previous: FxSeriesPoint | null;
  /** `latest − previous`. `null` on a one-point series. */
  readonly change: Decimal | null;
  /** `latest − first`, which is what the chart above it actually shows. */
  readonly changeOverWindow: Decimal | null;
}

const PLN = 'PLN';

/**
 * Builds one pair's series out of the PLN-based table NBP publishes.
 *
 * Cross pairs are computed, never stored — the same rule `convertViaPln`
 * follows for a single conversion, applied day by day. `rate = mid(base) /
 * mid(quote)` covers all three shapes uniformly, because PLN's own rate to PLN
 * is 1: USD/PLN reads the table straight, PLN/USD inverts it, EUR/USD divides
 * one column by the other.
 *
 * A date is in the result only when **both** legs were published on it. NBP
 * publishes table A as a whole, so in practice the two legs align; where they
 * do not — a currency that joined the table later, a row that failed to store —
 * the day is dropped rather than carried forward from the last one. Filling it
 * would draw a rate that was never fixed (rule 7).
 */
export function pairSeries(
  pair: CurrencyPair,
  ratesToPln: ReadonlyMap<Currency, readonly FxRate[]>,
): readonly FxSeriesPoint[] {
  if (pair.base === pair.quote) throw new SameCurrencyPairError(pair.base);

  const base = legByDate(pair.base, ratesToPln);
  const quote = legByDate(pair.quote, ratesToPln);
  if (base === null || quote === null) return [];

  // The pair's currencies differ, so at most one leg is PLN — whichever is not
  // supplies the dates. Both foreign, and the left leg does; the intersection
  // below drops anything the right one is missing either way.
  const dates = base !== PLN_LEG ? base.keys() : quote !== PLN_LEG ? quote.keys() : [];

  const points: FxSeriesPoint[] = [];
  for (const iso of dates) {
    const baseMid = midOn(base, iso);
    const quoteMid = midOn(quote, iso);
    if (baseMid === undefined || quoteMid === undefined) continue;
    points.push({ date: Temporal.PlainDate.from(iso), rate: baseMid.dividedBy(quoteMid) });
  }

  return points.sort((a, b) => Temporal.PlainDate.compare(a.date, b.date));
}

/**
 * PLN has no rows by construction — table A is PLN-based, so there is nothing
 * to publish for it — and stands in as a rate of 1 on whatever dates the other
 * leg carries. That is what makes `mid(base) / mid(quote)` cover a pair with
 * PLN on either side without a special case per direction.
 */
const PLN_LEG = Symbol('PLN');

type Leg = ReadonlyMap<string, Decimal> | typeof PLN_LEG;

/** `null` when the currency has no rows at all — the pair then has no series. */
function legByDate(
  code: Currency,
  ratesToPln: ReadonlyMap<Currency, readonly FxRate[]>,
): Leg | null {
  if (code === PLN) return PLN_LEG;

  const rows = ratesToPln.get(code);
  if (rows === undefined || rows.length === 0) return null;

  const byDate = new Map<string, Decimal>();
  for (const row of rows) byDate.set(row.date.toString(), row.mid);
  return byDate;
}

function midOn(leg: Leg, iso: string): Decimal | undefined {
  return leg === PLN_LEG ? ONE : leg.get(iso);
}

const ONE = new Decimal(1);

export function summarizeFxSeries(
  pair: CurrencyPair,
  points: readonly FxSeriesPoint[],
): FxSeriesSummary | null {
  const latest = points.at(-1);
  if (latest === undefined) return null;

  const previous = points.at(-2) ?? null;
  const first = points[0]!;

  return {
    pair,
    latest,
    previous,
    change: previous === null ? null : latest.rate.minus(previous.rate),
    changeOverWindow: previous === null ? null : latest.rate.minus(first.rate),
  };
}

/**
 * How stale the newest stored print may be before a refresh is worth a request.
 *
 * Table A is published on business days only, so a Monday reading a Friday
 * print is three days behind and entirely current. Four days is the first gap
 * that a plain weekend cannot explain — it takes a public holiday on top — and
 * re-fetching then costs one request that returns the same rows.
 */
const MAX_PRINT_AGE_DAYS = 4;

/**
 * Whether the stored rows are worth re-fetching for this window.
 *
 * Two ways to be short, and they need different requests: missing *history*
 * (the window starts before anything stored) and missing *recent* prints. Both
 * are answered by the same range fetch, so one predicate covers them.
 *
 * This is the throttle itself, not a scheduler — `architecture.md` forbids one.
 * Same shape as `isIndexSeriesDue`.
 */
export function isFxSeriesDue(
  stored: readonly FxRate[],
  window: { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate },
  today: Temporal.PlainDate,
): boolean {
  if (stored.length === 0) return true;

  const sorted = stored.slice().sort((a, b) => Temporal.PlainDate.compare(a.date, b.date));

  const oldest = sorted[0]!;
  const newest = sorted.at(-1)!;

  if (Temporal.PlainDate.compare(oldest.date, window.from) > 0) return true;
  return newest.date.until(today).days >= MAX_PRINT_AGE_DAYS;
}

export interface FxSeriesRefreshReport {
  readonly refreshed: readonly Currency[];
  /** Set when the provider failed. Whatever is stored is still served. */
  readonly error: string | null;
}

/**
 * Fetch the ranges a pair needs, where they are due, then leave reading to the
 * caller — the same read-then-refresh-then-re-read shape `/portfolio` uses for
 * prices (ADR 0014).
 *
 * A provider failure is reported, never thrown: `docs/data-sources.md` says
 * serve what is known with its date visible rather than erroring out. A chart
 * that is a week short is worth more than an error boundary.
 *
 * PLN is skipped rather than requested — table A has no PLN row, and asking
 * for one is the mistake that kept `fxDue` permanently true on `/portfolio`.
 */
export function makeRefreshFxSeries(deps: {
  readonly fx: FxRateRepository;
  readonly provider: FxRateProvider;
  readonly today: () => Temporal.PlainDate;
}) {
  const { fx, provider, today } = deps;

  return async function refreshFxSeries(
    pair: CurrencyPair,
    window: { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate },
  ): Promise<FxSeriesRefreshReport> {
    const wanted = [...new Set([pair.base, pair.quote])].filter((code) => code !== PLN);
    if (wanted.length === 0) return { refreshed: [], error: null };

    const stored = await fx.seriesFor(wanted, window.from, window.to);
    const now = today();
    const due = wanted.filter((code) => isFxSeriesDue(stored.get(code) ?? [], window, now));
    if (due.length === 0) return { refreshed: [], error: null };

    const refreshed: Currency[] = [];
    for (const code of due) {
      try {
        const rows = await provider.fetchSeriesTo(code, window.from, window.to);
        if (rows.length > 0) await fx.save(rows, provider.name);
        refreshed.push(code);
      } catch (cause) {
        return {
          refreshed,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }

    return { refreshed, error: null };
  };
}
