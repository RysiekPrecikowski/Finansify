import { wrappers, type Wrapper } from '@finansify/core';

import { assetClasses, type AssetClass } from '@/lib/dashboard/snapshot';

/**
 * `/portfolio`'s two filter dimensions, in the URL for the same reasons the
 * dashboard's are (`lib/dashboard-params.ts`): the page renders on the server,
 * every chip is a real link, and the view survives a reload and a share.
 *
 * Deliberately **not** a new "custom portfolios" concept — both dimensions are
 * structure the ledger already has. `assetClass` is the instrument's own kind;
 * `wrapper` is the tax wrapper of the account a position is held in, which is
 * the axis a Polish investor actually reasons about (`docs/product.md`).
 *
 * There is no client-side switching here, so unlike the dashboard's `range`
 * these never need a `replaceState` path — every change is a navigation.
 */
export interface PortfolioParams {
  readonly assetClass: AssetClass | null;
  readonly wrapper: Wrapper | null;
}

export const defaultPortfolioParams: PortfolioParams = { assetClass: null, wrapper: null };

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(candidates: readonly T[], value: string | undefined): T | null {
  return candidates.find((candidate) => candidate === value) ?? null;
}

/** Unknown or malformed values fall back to "no filter" rather than erroring. */
export function parsePortfolioParams(raw: RawSearchParams): PortfolioParams {
  return {
    assetClass: oneOf(assetClasses, first(raw.class)),
    wrapper: oneOf(wrappers, first(raw.wrapper)),
  };
}

export interface PortfolioHref {
  readonly pathname: '/portfolio';
  readonly query: Record<string, string>;
}

/** Keeps the dimension you are not changing, so the two filters compose. */
export function portfolioHref(
  current: PortfolioParams,
  changes: Partial<PortfolioParams>,
): PortfolioHref {
  const next = { ...current, ...changes };
  const query: Record<string, string> = {};

  if (next.assetClass !== null) query.class = next.assetClass;
  if (next.wrapper !== null) query.wrapper = next.wrapper;

  return { pathname: '/portfolio', query };
}
