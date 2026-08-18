import {
  Money,
  currency,
  parseSeriesCode,
  Temporal,
  type BondInterestTable,
  type BondInterestTableRepository,
  type BondIssueParameterRepository,
  type BondIssueParameters,
  type BondSeriesCode,
  type IndexId,
  type IndexObservation,
  type IndexObservationRepository,
  type ProviderName,
  type PurchaseDayKey,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { type Database } from './client';
import {
  bondInterestTables,
  bondSeriesTerms,
  indexObservations,
  type BondInterestTableRow,
  type BondSeriesTermsRow,
  type IndexObservationRow,
} from './schema/bonds';

/**
 * The persistence adapters for `core`'s bond ports (ADR 0011). Both tables are
 * global — no `userId` anywhere in this file, same reasoning as
 * `marketPriceRepository` in `price-repository.ts`.
 *
 * `numeric` columns arrive as strings and go straight to `Decimal`; no
 * `Number()` anywhere here (rule 1).
 */

/** Rates are stored to six decimals; keep writes at that scale so reads round-trip. */
const RATE_SCALE = 6;

/** Every retail series is issued in PLN; nothing here is ever another currency. */
const PLN = currency('PLN');

function toIssueParameters(row: BondSeriesTermsRow): BondIssueParameters {
  return {
    seriesCode: parseSeriesCode(row.seriesCode).code,
    firstPeriodRate: new Decimal(row.firstPeriodRate),
    margin: new Decimal(row.margin),
  };
}

function toIndexObservation(row: IndexObservationRow): IndexObservation {
  return {
    indexId: row.indexId,
    effectiveFrom: Temporal.PlainDate.from(row.effectiveFrom),
    value: new Decimal(row.value),
  };
}

export function bondIssueParameterRepository(db: Database): BondIssueParameterRepository {
  return {
    async find(codes: readonly BondSeriesCode[]) {
      if (codes.length === 0) return new Map();
      const rows = await db
        .select()
        .from(bondSeriesTerms)
        .where(inArray(bondSeriesTerms.seriesCode, [...codes]));

      const result = new Map<BondSeriesCode, BondIssueParameters>();
      for (const row of rows) {
        result.set(row.seriesCode as BondSeriesCode, toIssueParameters(row));
      }
      return result;
    },

    async save(parameters: BondIssueParameters, source: ProviderName) {
      // Parse rather than trust: `family` is a denormalization of the code, and
      // this is the only place that can guarantee the two agree.
      const parsed = parseSeriesCode(parameters.seriesCode);
      await db
        .insert(bondSeriesTerms)
        .values({
          seriesCode: parsed.code,
          family: parsed.family,
          firstPeriodRate: parameters.firstPeriodRate.toFixed(RATE_SCALE),
          margin: parameters.margin.toFixed(RATE_SCALE),
          source,
          resolvedAt: new Date(),
        })
        // Deliberately not an upsert of the rates. A series' published terms are
        // fixed for its whole life, so a *changed* value means the parser broke,
        // not that the Ministry revised anything — and silently rewriting it
        // would re-value every existing holding of that series. First
        // resolution wins; only the freshness stamp moves. A genuinely wrong
        // row is corrected by hand, which is the manual-override tier in
        // `docs/data-sources.md`.
        .onConflictDoUpdate({
          target: bondSeriesTerms.seriesCode,
          set: { resolvedAt: sql`excluded.resolved_at` },
        });
    },
  };
}

export function indexObservationRepository(db: Database): IndexObservationRepository {
  return {
    async history(indexId: IndexId) {
      // Oldest first: the accrual engine replays periods forward, and both
      // series are small enough (a few NBP changes a year, twelve CPI prints)
      // that paging would be premature.
      const rows = await db
        .select()
        .from(indexObservations)
        .where(eq(indexObservations.indexId, indexId))
        .orderBy(asc(indexObservations.effectiveFrom));
      return rows.map(toIndexObservation);
    },

    async latest(indexId: IndexId) {
      const [row] = await db
        .select()
        .from(indexObservations)
        .where(eq(indexObservations.indexId, indexId))
        .orderBy(desc(indexObservations.effectiveFrom))
        .limit(1);
      return row === undefined ? null : toIndexObservation(row);
    },

    async save(observations: readonly IndexObservation[], source: ProviderName) {
      if (observations.length === 0) return;
      const fetchedAt = new Date();
      await db
        .insert(indexObservations)
        .values(
          observations.map((observation) => ({
            indexId: observation.indexId,
            effectiveFrom: observation.effectiveFrom.toString(),
            value: observation.value.toFixed(RATE_SCALE),
            source,
            fetchedAt,
          })),
        )
        // Unlike bond terms, a macro observation *is* revised — GUS restates a
        // CPI print occasionally — so the newest fetch wins here.
        .onConflictDoUpdate({
          target: [indexObservations.indexId, indexObservations.effectiveFrom],
          set: {
            value: sql`excluded.value`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },
  };
}

function toInterestTable(row: BondInterestTableRow): BondInterestTable {
  return {
    seriesCode: parseSeriesCode(row.seriesCode).code,
    periodOrdinal: row.periodOrdinal,
    purchaseDayKey: row.purchaseDayKey as PurchaseDayKey,
    startsOn: Temporal.PlainDate.from(row.startsOn),
    endsOn: Temporal.PlainDate.from(row.endsOn),
    annualRate: new Decimal(row.annualRate),
    source: row.source,
    // Strings straight to `Money`, never through a number (rule 1). The values
    // were rounded to the grosz by the agent that published them and are not
    // re-rounded on either side of the database.
    dailyValues: row.dailyValues.map((value) => Money.of(value, PLN)),
  };
}

export function bondInterestTableRepository(db: Database): BondInterestTableRepository {
  return {
    async find(code: BondSeriesCode, purchaseDayKey: PurchaseDayKey) {
      const rows = await db
        .select()
        .from(bondInterestTables)
        .where(
          and(
            eq(bondInterestTables.seriesCode, code),
            eq(bondInterestTables.purchaseDayKey, purchaseDayKey),
          ),
        )
        .orderBy(asc(bondInterestTables.periodOrdinal));

      const result = new Map<number, BondInterestTable>();
      for (const row of rows) result.set(row.periodOrdinal, toInterestTable(row));
      return result;
    },

    async save(tables: readonly BondInterestTable[]) {
      if (tables.length === 0) return;
      const fetchedAt = new Date();
      await db
        .insert(bondInterestTables)
        .values(
          tables.map((table) => ({
            seriesCode: table.seriesCode,
            purchaseDayKey: table.purchaseDayKey,
            periodOrdinal: table.periodOrdinal,
            startsOn: table.startsOn.toString(),
            endsOn: table.endsOn.toString(),
            annualRate: table.annualRate.toFixed(RATE_SCALE),
            dailyValues: table.dailyValues.map((value) => value.amount.toFixed(2)),
            source: table.source,
            fetchedAt,
          })),
        )
        // The newest fetch wins, unlike `bond_series_terms`. A *closed* period's
        // table is fixed forever, but the current one grows a row a day and the
        // Ministry restates a rate on the rare occasion the index behind it is
        // revised — so refusing to update would freeze a partial table in place
        // and under-report the holding for the rest of the period.
        .onConflictDoUpdate({
          target: [
            bondInterestTables.seriesCode,
            bondInterestTables.purchaseDayKey,
            bondInterestTables.periodOrdinal,
          ],
          set: {
            startsOn: sql`excluded.starts_on`,
            endsOn: sql`excluded.ends_on`,
            annualRate: sql`excluded.annual_rate`,
            dailyValues: sql`excluded.daily_values`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },
  };
}
