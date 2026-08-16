/**
 * The bond domain's closed value lists, and **nothing else**.
 *
 * Dependency-free for the same reason `ledger/vocabulary.ts` is: `packages/db`
 * builds its `pgEnum`s from these arrays, and drizzle-kit loads the schema
 * through a CJS require hook that cannot resolve `temporal-polyfill`'s ESM-only
 * subpaths. Reaching this through the package root would drag the polyfill in
 * and break `db:generate` outright.
 *
 * `docs/domain.md` is the source for every list here.
 */

/**
 * The eight retail families the Ministry currently issues. ADR 0011: a family
 * is stable domain knowledge (they change on the order of once a decade), so it
 * lives in code; the per-issue numbers live in `bond_series_terms`.
 *
 * Historical families that no longer issue — DOS, TOZ, KOS, POS — are
 * deliberately absent. They appear in obligacjeskarbowe.pl's archive dropdowns
 * but nobody can buy one, and a family nobody holds is speculative config.
 */
export const bondFamilies = ['OTS', 'ROR', 'DOR', 'TOS', 'COI', 'ROS', 'EDO', 'ROD'] as const;
export type BondFamily = (typeof bondFamilies)[number];

/**
 * The macro series a floating family indexes against. Both land in the global
 * `index_observations` table; neither is user data (ADR 0010).
 */
export const indexIds = ['nbp_reference', 'pl_cpi_yoy'] as const;
export type IndexId = (typeof indexIds)[number];

/** When the holder actually receives the interest, as distinct from when it accrues. */
export const payoutSchedules = ['monthly', 'annual', 'at_redemption'] as const;
export type PayoutSchedule = (typeof payoutSchedules)[number];
