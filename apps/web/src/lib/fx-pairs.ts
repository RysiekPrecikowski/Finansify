// The pair and the range live in the URL, same reasoning as the dashboard's
// controls (`lib/dashboard-params.ts`): the card renders on the server, every
// control is a real link, and the view survives a reload and a share.
//
// Kept free of `@finansify/core` so the picker can import it from a client
// component; the branded `Currency` is built on the server side.

/** Base first, quote second — `usd_pln` is "PLN per USD". */
export const fxPairs = ['usd_pln', 'eur_pln', 'gbp_pln', 'chf_pln', 'eur_usd'] as const;

export type FxPairId = (typeof fxPairs)[number];

export const defaultFxPair: FxPairId = 'usd_pln';

export function isFxPair(value: unknown): value is FxPairId {
  return typeof value === 'string' && (fxPairs as readonly string[]).includes(value);
}

/** `usd_pln` → `['USD', 'PLN']`. The label is the same thing with a slash. */
export function codesOf(pair: FxPairId): readonly [string, string] {
  const [base, quote] = pair.split('_');
  return [base!.toUpperCase(), quote!.toUpperCase()];
}

export function fxPairLabel(pair: FxPairId): string {
  return codesOf(pair).join('/');
}

/**
 * Window lengths, not calendar buckets. `max` is bounded by the data rather
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
  readonly pair: FxPairId;
  readonly range: FxRangeId;
}

export const defaultFxParams: FxParams = { pair: defaultFxPair, range: defaultFxRange };

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Anything unrecognised falls back rather than throwing — these come from the URL bar. */
export function fxParamsFrom(raw: RawSearchParams): FxParams {
  const pair = first(raw.pair);
  const range = first(raw.range);

  return {
    pair: isFxPair(pair) ? pair : defaultFxPair,
    range: isFxRange(range) ? range : defaultFxRange,
  };
}

export interface FxHref {
  readonly pathname: '/indicators';
  readonly query: Record<string, string>;
}

/** Keeps the parameter you are not changing, so the two pickers compose. */
export function fxHref(current: FxParams, changes: Partial<FxParams>): FxHref {
  const next = { ...current, ...changes };
  const query: Record<string, string> = {};

  if (next.pair !== defaultFxParams.pair) query.pair = next.pair;
  if (next.range !== defaultFxParams.range) query.range = next.range;

  return { pathname: '/indicators', query };
}
