import type Decimal from 'decimal.js';

import { type Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';
import { type BondInterestTable, type PurchaseDayKey } from './interest-table';
import { type BondSeriesCode, type BondTerms, type IndexId, type IndexObservation } from './types';

/**
 * The per-issue half of a bond's terms — the two numbers the Ministry publishes
 * monthly in the emission letter. Returns `null` when the issue cannot be
 * resolved, so `BondTermsResolver` can fall through the tiers in
 * `docs/data-sources.md` rather than being handed a guess.
 *
 * There is deliberately no "fetch every issue" method. ADR 0011 rejects eager
 * population: lazy resolution fetches exactly the series someone holds.
 */
export interface BondIssueParameterProvider {
  readonly name: ProviderName;
  fetchIssueParameters(code: BondSeriesCode): Promise<BondIssueParameters | null>;
}

/** What an emission letter adds on top of the family rules. Fractions, not percents. */
export interface BondIssueParameters {
  readonly seriesCode: BondSeriesCode;
  readonly firstPeriodRate: Decimal;
  readonly margin: Decimal;
}

/**
 * The global `bond_series_terms` cache. No user scoping — an issue's published
 * rate and margin are identical for everyone who holds it.
 *
 * It caches **issue parameters, not composed `BondTerms`**, and the distinction
 * is load-bearing rather than pedantic: family rules are effective-dated by the
 * *purchase* date (the early-redemption fee moved on 2024-09-01), and a global
 * table has no purchase date to resolve them against. Storing composed terms
 * would freeze one holder's fee onto a row every other holder then reads.
 * `BondTermsResolver` does the composition, per holding.
 */
export interface BondIssueParameterRepository {
  find(codes: readonly BondSeriesCode[]): Promise<ReadonlyMap<BondSeriesCode, BondIssueParameters>>;
  save(parameters: BondIssueParameters, source: ProviderName): Promise<void>;
}

/**
 * ADR 0011's cache-on-first-use resolver: read the issue parameters (fetching
 * and caching them if this is the first time anyone has held the series),
 * compose them with the family rules in force on `purchasedOn`, hand back the
 * terms the accrual engine takes.
 */
export interface BondTermsResolver {
  resolve(code: BondSeriesCode, purchasedOn: Temporal.PlainDate): Promise<BondTerms | null>;
}

/**
 * Fetches a macro series. Both implementations return **all** observations they
 * can see rather than only the newest: the series are tiny (a handful of NBP
 * changes a year, twelve CPI prints), and a bond bought years ago needs the
 * history, not the latest value.
 */
export interface IndexObservationProvider {
  readonly name: ProviderName;
  readonly indexId: IndexId;
  fetchObservations(): Promise<readonly IndexObservation[]>;
}

/** The global `index_observations` cache. Shared across users (ADR 0010). */
export interface IndexObservationRepository {
  /**
   * Every observation for this series, oldest first. The accrual engine needs
   * the whole history to rebuild past periods, and the series is small enough
   * that paging it would be premature.
   */
  history(indexId: IndexId): Promise<readonly IndexObservation[]>;
  latest(indexId: IndexId): Promise<IndexObservation | null>;
  save(observations: readonly IndexObservation[], source: ProviderName): Promise<void>;
}

/**
 * One published daily interest table, identified the way the emission agent
 * identifies it: the interest period, and the purchase day whose schedule it
 * describes.
 */
export interface BondInterestTableKey {
  readonly periodOrdinal: number;
  readonly purchaseDayKey: PurchaseDayKey;
}

/**
 * The official tables, from whichever emission agent serves them (ADR 0016).
 *
 * Lazy for the same reason `BondIssueParameterProvider` is (ADR 0011): a series
 * has up to 144 periods and there are hundreds of series, so fetching is driven
 * by what someone actually holds. `null` rather than a throw when a table is
 * not published — three of the eight families have none at all, and that is a
 * boundary of the source rather than a failure of the fetch.
 */
export interface BondInterestTableProvider {
  readonly name: ProviderName;
  /** Which tables exist for this series. Empty when the agent publishes none. */
  fetchPublishedTables(code: BondSeriesCode): Promise<readonly BondInterestTableKey[]>;
  fetchTable(code: BondSeriesCode, key: BondInterestTableKey): Promise<BondInterestTable | null>;
}

/**
 * The global `bond_interest_tables` cache. No user scoping: a published table
 * is the same figure for everyone who holds the series (ADR 0010).
 *
 * Only *published* tables are ever written here. A value our own engine
 * computed must never be stored as though it were sourced, or a series would
 * stay on our arithmetic forever instead of picking up the official table the
 * day it appears.
 */
export interface BondInterestTableRepository {
  /** Every table on hand for this series and purchase day, keyed by ordinal. */
  find(
    code: BondSeriesCode,
    purchaseDayKey: PurchaseDayKey,
  ): Promise<ReadonlyMap<number, BondInterestTable>>;
  save(tables: readonly BondInterestTable[]): Promise<void>;
}
