// The pair and the range live in the URL, same reasoning as the dashboard's
// controls (`lib/dashboard-params.ts`): the card renders on the server, every
// control is a real link, and the view survives a reload and a share.
//
// Kept free of `@finansify/core` so the pickers can import it from a client
// component; the branded `Currency` is built on the server side.

/**
 * Everything NBP table A carries — any of it against any other. Deliberately
 * **not** the presentation list (`display/currencies.ts`, five): a pair chart
 * is a one-off lookup, so breadth costs the reader nothing, while a
 * presentation currency is a standing choice that a 33-entry menu would make
 * worse.
 *
 * Breadth is free on the fetch side too. `fetchTableTo` pulls the whole table
 * in one request and `refreshFxRates` stores every row, so a rate for TRY is
 * already on file the moment a rate for USD is.
 *
 * PLN leads because table A is PLN-based and has no row of its own; the four
 * after it are the ones anyone here actually holds, and the rest is
 * alphabetical. Verified against a live table on 2026-08-14 (32 rows + PLN).
 * XDR is the IMF's basket rather than a currency anyone is paid in; it stays,
 * because table A quotes it and excluding it is a judgement this list has no
 * business making.
 */
export const fxCurrencies = [
  'PLN',
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'AUD',
  'BRL',
  'CAD',
  'CLP',
  'CNY',
  'CZK',
  'DKK',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'UAH',
  'XDR',
  'ZAR',
] as const;

export type FxCurrency = (typeof fxCurrencies)[number];

/** The five kept together above a separator in each leg's picker. */
export const commonFxCurrencies = fxCurrencies.slice(0, 5) as readonly FxCurrency[];

export function isFxCurrency(value: unknown): value is FxCurrency {
  return typeof value === 'string' && (fxCurrencies as readonly string[]).includes(value);
}

export interface FxPair {
  readonly base: FxCurrency;
  readonly quote: FxCurrency;
}

export const defaultFxPair: FxPair = { base: 'USD', quote: 'PLN' };

export function fxPairLabel(pair: FxPair): string {
  return `${pair.base}/${pair.quote}`;
}

/**
 * Window lengths, not calendar buckets. `MAX` is bounded by the data rather
 * than by a preference: NBP's own archive starts on 2002-01-02, and asking for
 * anything earlier returns a 404 per chunk — see the adapter.
 */
export const fxRanges = ['1M', '3M', '1Y', '5Y', 'MAX'] as const;

export type FxRangeId = (typeof fxRanges)[number];

export const defaultFxRange: FxRangeId = '1Y';

export function isFxRange(value: unknown): value is FxRangeId {
  return typeof value === 'string' && (fxRanges as readonly string[]).includes(value);
}

export const fxRangeMonths: Record<Exclude<FxRangeId, 'MAX'>, number> = {
  '1M': 1,
  '3M': 3,
  '1Y': 12,
  '5Y': 60,
};

/** The first day NBP's table-A archive covers. */
export const NBP_ARCHIVE_START = '2002-01-02';

export interface FxParams {
  readonly pair: FxPair;
  readonly range: FxRangeId;
}

export const defaultFxParams: FxParams = { pair: defaultFxPair, range: defaultFxRange };

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Anything unrecognised falls back rather than throwing — these come from the
 * URL bar.
 *
 * A pair of one currency is refused the same way. `core`'s `pairSeries` throws
 * on it deliberately (a flat line at 1 is not a fact about anything), so it
 * must never reach the server from a hand-edited URL.
 */
export function fxParamsFrom(raw: RawSearchParams): FxParams {
  const base = first(raw.base);
  const quote = first(raw.quote);
  const range = first(raw.range);

  const pair: FxPair = {
    base: isFxCurrency(base) ? base : defaultFxPair.base,
    quote: isFxCurrency(quote) ? quote : defaultFxPair.quote,
  };

  return {
    pair: pair.base === pair.quote ? fallbackFor(pair.base) : pair,
    range: isFxRange(range) ? range : defaultFxRange,
  };
}

/** X/X is not a pair; quote it against PLN, or against USD when X *is* PLN. */
function fallbackFor(base: FxCurrency): FxPair {
  return { base, quote: base === 'PLN' ? 'USD' : 'PLN' };
}

export interface FxHref {
  readonly pathname: '/indicators';
  readonly query: Record<string, string>;
}

/**
 * Keeps the parameters you are not changing, so the three pickers compose.
 *
 * Picking a currency that is already the other leg **swaps** rather than
 * producing X/X: choosing USD as the quote of USD/PLN gives PLN/USD, which is
 * what someone clicking it meant.
 */
export function fxHref(current: FxParams, changes: Partial<FxParams>): FxHref {
  const merged = { ...current, ...changes };
  const next: FxParams = {
    ...merged,
    pair: normalize(current.pair, merged.pair),
  };

  const query: Record<string, string> = {};
  if (next.pair.base !== defaultFxParams.pair.base) query.base = next.pair.base;
  if (next.pair.quote !== defaultFxParams.pair.quote) query.quote = next.pair.quote;
  if (next.range !== defaultFxParams.range) query.range = next.range;

  return { pathname: '/indicators', query };
}

function normalize(current: FxPair, next: FxPair): FxPair {
  if (next.base !== next.quote) return next;
  return { base: current.quote, quote: current.base };
}
