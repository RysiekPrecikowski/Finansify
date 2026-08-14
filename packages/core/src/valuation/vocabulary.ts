/**
 * The valuation domain's closed value lists, kept dependency-free for the same
 * reason `ledger/vocabulary.ts` is: `packages/db` builds a `pgEnum` from
 * `providerNames` and drizzle-kit's CJS require hook cannot resolve
 * `temporal-polyfill`'s ESM-only subpaths. Reaching this through the package
 * root would drag the polyfill in and break `db:generate`.
 */

/** Every source Finansify fetches market data from — prices and FX alike. */
export const providerNames = ['yahoo', 'nbp'] as const;
export type ProviderName = (typeof providerNames)[number];
