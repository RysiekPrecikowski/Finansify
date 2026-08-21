import { bondFamilies, indexIds } from '@finansify/core/vocabulary';
import {
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

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

/**
 * One published daily interest table, exactly as an emission agent serves it
 * (ADR 0019). Global and unscoped like everything else here: the Ministry
 * publishes one figure per series, period and purchase day, and it is the same
 * figure for every holder.
 *
 * The primary key is `(series_code, purchase_day_key, period_ordinal)` because
 * that triple *is* the table's published identity — Pekao keys its own
 * endpoint on it — and because keying on it lets two concurrent renders race
 * harmlessly onto the same row instead of inserting twice, the same reason
 * `index_observations` keys the way it does.
 *
 * Nothing our own engine computed may ever be written here. A stored value is
 * a claim that an agent published it, and the whole point of the fallback is
 * that a series still on our arithmetic picks up the official table the day it
 * appears — which cannot happen if we have already filled the row ourselves.
 */
export const bondInterestTables = pgTable(
  'bond_interest_tables',
  {
    seriesCode: text('series_code').notNull(),
    /** 1, 29, 30 or 31 — the four purchase days the agents publish for. */
    purchaseDayKey: smallint('purchase_day_key').notNull(),
    /** 1-based, matching the published "Okres odsetkowy". */
    periodOrdinal: integer('period_ordinal').notNull(),
    /**
     * The published period bounds, stored **as published** rather than
     * normalized onto our own period convention. The two genuinely differ: a
     * capitalizing family's table opens the day after the previous one closes,
     * and flattening that away here would lose the one signal
     * `readInterestTable` uses to tell the two conventions apart.
     */
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    /** A fraction, like every other rate here: 5.25% is `0.052500`. */
    annualRate: rate('annual_rate').notNull(),
    /**
     * One value per calendar day from `starts_on` to `ends_on` inclusive, in
     * order, **per bond** — up to 366 entries for an annual period.
     *
     * `jsonb` of decimal *strings*, not `numeric[]` and never floats: these are
     * money, they arrive rounded to the grosz, and they must round-trip to
     * `Decimal` unchanged (rule 1). A JSON number would put them through a
     * double on the way in and out.
     */
    dailyValues: jsonb('daily_values').$type<readonly string[]>().notNull(),
    source: providerNameEnum('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.seriesCode, table.purchaseDayKey, table.periodOrdinal],
    }),
  ],
);

export type BondInterestTableRow = typeof bondInterestTables.$inferSelect;
export type NewBondInterestTableRow = typeof bondInterestTables.$inferInsert;

/**
 * ADR 0023's cache-on-first-use table for Catalyst bonds: the one number
 * `gpwcatalyst.pl` publishes that `bond_series_terms` has no use for — nominal
 * value. Global and unscoped like every other bond-reference table here.
 *
 * Keyed by `symbol` (the Catalyst ticker, e.g. `GHE0128`), not ISIN —
 * `gpwcatalyst.pl`'s own instrument page answers to the ticker, and it is
 * already `instruments.symbol` for a `catalyst_bond`. `chart-json.php`, which
 * prices the bond, is keyed by ISIN instead (`instrument_identifiers.symbol`
 * for provider `gpw`) — two different "symbol"s for two different GPW
 * endpoints, not a typo.
 *
 * `currency` rides along because a Catalyst issue is not guaranteed PLN the
 * way a retail bond is; `nominal` and `currency` are read back straight into a
 * `Money`, not composed with anything else, so — unlike `bond_series_terms` —
 * there is no separate resolver-side composition step.
 */
export const catalystBondTerms = pgTable('catalyst_bond_terms', {
  symbol: text('symbol').primaryKey(),
  nominal: numeric('nominal', { precision: 20, scale: 8, mode: 'string' }).notNull(),
  currency: text('currency').notNull(),
  source: providerNameEnum('source').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CatalystBondTermsRow = typeof catalystBondTerms.$inferSelect;
export type NewCatalystBondTermsRow = typeof catalystBondTerms.$inferInsert;
