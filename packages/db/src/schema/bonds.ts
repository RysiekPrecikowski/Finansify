import { bondFamilies, indexIds } from '@finansify/core/vocabulary';
import { date, numeric, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { providerNameEnum } from './prices';

export const bondFamilyEnum = pgEnum('bond_family', bondFamilies);
export const indexIdEnum = pgEnum('index_id', indexIds);

/**
 * Both tables are **global and unscoped** — bond terms and macro series
 * describe the world, not a user, exactly like `instruments` and `prices`
 * (ADR 0010). There is deliberately no `user_id` here and no `forUser`
 * repository: a series' terms are identical for everyone who holds it, and
 * forking them per user would mean re-scraping the Ministry once per account.
 */

/**
 * Rates and margins are stored as fractions, not percentages — 5.35% is
 * `0.053500`. Six decimal places is three more than any published figure uses,
 * which leaves room for a margin quoted in basis points without inviting the
 * idea that this column holds money.
 */
const rate = <TName extends string>(name: TName) =>
  numeric(name, { precision: 12, scale: 6, mode: 'string' });

/**
 * ADR 0011's cache-on-first-use table: the per-issue half of a bond's terms,
 * populated the first time anyone holds a series and shared from then on.
 *
 * Only the two published numbers live here. The family rules — tenor,
 * capitalization, payout schedule, early-redemption fee — are versioned
 * configuration in `packages/core/src/bonds/families.ts`, because they are
 * domain knowledge that wants review and tests, not fetched data. Putting
 * either in the other's place is how this turns into a mess.
 *
 * That split is also why this table cannot hold composed `BondTerms`: family
 * rules are effective-dated by the *purchase* date, and this row is shared by
 * every holder of the series regardless of when they bought.
 */
export const bondSeriesTerms = pgTable('bond_series_terms', {
  seriesCode: text('series_code').primaryKey(),
  /**
   * Derivable from the code, and stored anyway — it is the one denormalization
   * that earns its place, because "every EDO series we know about" is a query
   * and re-parsing 400 codes in JS to answer it is not. Written only after
   * `parseSeriesCode` has validated it, so it cannot disagree with the code.
   *
   * Nothing else here is derived. In particular the index and the redemption
   * month are *not* columns: both follow from the family and the code, and a
   * copy that can drift from the configuration is worse than a join.
   */
  family: bondFamilyEnum('family').notNull(),
  firstPeriodRate: rate('first_period_rate').notNull(),
  margin: rate('margin').notNull(),
  source: providerNameEnum('source').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BondSeriesTermsRow = typeof bondSeriesTerms.$inferSelect;
export type NewBondSeriesTermsRow = typeof bondSeriesTerms.$inferInsert;

/**
 * One observation of a macro series, keyed by the date it becomes usable.
 *
 * `(index_id, effective_from)` is the primary key for the same reason
 * `instrument_prices` keys on `(instrument_id, date)`: two concurrent refreshes
 * race harmlessly onto the same row instead of inserting twice.
 *
 * For the NBP reference rate `effective_from` is the rate's own `obowiazuje_od`.
 * For CPI it is the first day of the month the figure was **announced** in, not
 * the month it describes — the indexed families use "the print announced in the
 * month preceding the interest period", and dating by announcement turns that
 * into a single `effective_from < period_start` lookup rather than two rules.
 */
export const indexObservations = pgTable(
  'index_observations',
  {
    indexId: indexIdEnum('index_id').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    /** A fraction, matching the domain: 3.0% year-on-year is `0.030000`. */
    value: rate('value').notNull(),
    source: providerNameEnum('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.indexId, table.effectiveFrom] })],
);

export type IndexObservationRow = typeof indexObservations.$inferSelect;
export type NewIndexObservationRow = typeof indexObservations.$inferInsert;
