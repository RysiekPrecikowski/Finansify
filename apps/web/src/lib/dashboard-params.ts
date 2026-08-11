import {
  assetClasses,
  ranges,
  sortOrders,
  type AssetClass,
  type Range,
  type SortOrder,
} from '@/lib/fixtures/portfolio';

/**
 * Range, filter and sort live in the URL rather than in client state. The whole
 * dashboard then renders on the server, every control is a real link, and the
 * view survives a reload and a share — which client-side tabs do not.
 */
export interface DashboardParams {
  readonly range: Range;
  readonly assetClass: AssetClass | null;
  readonly sort: SortOrder;
}

export const defaultDashboardParams: DashboardParams = {
  range: '1M',
  assetClass: null,
  sort: 'valueDesc',
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(candidates: readonly T[], value: string | undefined): T | null {
  return candidates.find((candidate) => candidate === value) ?? null;
}

/** Unknown or malformed values fall back to the default rather than erroring. */
export function parseDashboardParams(raw: RawSearchParams): DashboardParams {
  return {
    range: oneOf(ranges, first(raw.range)) ?? defaultDashboardParams.range,
    assetClass: oneOf(assetClasses, first(raw.class)),
    sort: oneOf(sortOrders, first(raw.sort)) ?? defaultDashboardParams.sort,
  };
}

export interface DashboardHref {
  readonly pathname: '/dashboard';
  readonly query: Record<string, string>;
}

/** Keeps the parameters you are not changing, so controls compose. */
export function dashboardHref(
  current: DashboardParams,
  changes: Partial<DashboardParams>,
): DashboardHref {
  const next = { ...current, ...changes };
  const query: Record<string, string> = {};

  if (next.range !== defaultDashboardParams.range) query.range = next.range;
  if (next.assetClass !== null) query.class = next.assetClass;
  if (next.sort !== defaultDashboardParams.sort) query.sort = next.sort;

  return { pathname: '/dashboard', query };
}
