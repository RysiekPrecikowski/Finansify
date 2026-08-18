/**
 * The valuation domain's closed value lists, kept dependency-free for the same
 * reason `ledger/vocabulary.ts` is: `packages/db` builds a `pgEnum` from
 * `providerNames` and drizzle-kit's CJS require hook cannot resolve
 * `temporal-polyfill`'s ESM-only subpaths. Reaching this through the package
 * root would drag the polyfill in and break `db:generate`.
 */

/**
 * Every source Finansify fetches market data from — prices, FX and the macro
 * series the bond engine indexes against.
 *
 * `gus` is Poland's statistics office (monthly CPI) and `mf` the Ministry of
 * Finance's retail-bond site (per-issue parameters). Both are listed here
 * before their adapters exist, because `bond_series_terms.source` and
 * `index_observations.source` are `pgEnum`s over this list and a column cannot
 * reference a value the enum does not carry.
 *
 * `pekao` is Bank Pekao, the second emission agent, and is the source of the
 * daily interest tables a `BondAccrual` can be read from instead of computed
 * (ADR 0018). It is a provider like the others: a figure attributed to it is
 * one the Ministry published, not one we derived.
 */
export const providerNames = ['yahoo', 'nbp', 'gus', 'mf', 'pekao'] as const;
export type ProviderName = (typeof providerNames)[number];
