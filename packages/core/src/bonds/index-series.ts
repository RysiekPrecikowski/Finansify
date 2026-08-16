import type Decimal from 'decimal.js';

import { Temporal } from '../time';
import { type ProviderName } from '../valuation/vocabulary';
import { type IndexObservationProvider, type IndexObservationRepository } from './ports';
import { type IndexId, type IndexObservation } from './types';

/** The newest reading of a macro series, and how it moved. */
export interface IndexSummary {
  readonly indexId: IndexId;
  readonly latest: IndexObservation;
  /** The reading before it, if the series has one. */
  readonly previous: IndexObservation | null;
  /** `latest − previous`, in the same fraction units. `null` on a one-point series. */
  readonly change: Decimal | null;
}

/**
 * Newest reading plus the one before it. Takes the whole stored series rather
 * than a "latest" query so the caller can also chart it — both series are small
 * enough (a handful of NBP changes a year, twelve CPI prints) that fetching all
 * of it and slicing here is cheaper than two round trips.
 */
export function summarizeIndexSeries(
  indexId: IndexId,
  observations: readonly IndexObservation[],
): IndexSummary | null {
  const series = observations
    .filter((observation) => observation.indexId === indexId)
    .slice()
    .sort((a, b) => Temporal.PlainDate.compare(a.effectiveFrom, b.effectiveFrom));

  const latest = series.at(-1);
  if (latest === undefined) return null;

  const previous = series.at(-2) ?? null;
  return {
    indexId,
    latest,
    previous,
    change: previous === null ? null : latest.value.minus(previous.value),
  };
}

/**
 * Whether a series is worth re-fetching, given what is already stored.
 *
 * The two series go stale in genuinely different ways, so one rule for both
 * would be wrong in one direction or the other:
 *
 * - **CPI** is published on a fixed monthly cadence. Once the calendar month
 *   has moved past the newest print we hold, a new one may exist; within the
 *   same month it certainly does not.
 * - **The NBP reference rate** changes only when the RPP decides to move it,
 *   which it can do at any of its roughly monthly meetings. Keying on the
 *   calendar month would miss a second change inside one month, so this one is
 *   a plain age check instead.
 *
 * Neither is a scheduler — `architecture.md` forbids one. This check *is* the
 * throttle: a read performs it on itself, and it costs one `latest()` query per
 * render. There is no `use cache` boundary above it — nothing in `apps/web` uses
 * one — so the network hop is held to roughly once a day by this rule alone,
 * not by a cache.
 */
const REFERENCE_RATE_MAX_AGE_DAYS = 7;

/**
 * Where the freshness actually comes from, stated once because it is spread
 * across three call sites:
 *
 * - **The macro series** re-check on the rules below — CPI once the calendar
 *   month passes its newest print, the reference rate weekly. Both `/indicators`
 *   and `/portfolio` run the check, so a user who only ever opens one of them
 *   still gets current data.
 * - **Bond values are recomputed on every read**, because an accrual is a
 *   function of `asOf`: yesterday's holding is re-accrued today without
 *   anything being fetched or stored. There is no bond-value cache to go stale.
 */

export function isIndexSeriesDue(
  indexId: IndexId,
  newest: IndexObservation | null,
  today: Temporal.PlainDate,
): boolean {
  if (newest === null) return true;

  if (indexId === 'pl_cpi_yoy') {
    return (
      Temporal.PlainYearMonth.compare(
        newest.effectiveFrom.toPlainYearMonth(),
        today.toPlainYearMonth(),
      ) < 0
    );
  }

  return newest.effectiveFrom.until(today).days >= REFERENCE_RATE_MAX_AGE_DAYS;
}

export interface IndexRefreshReport {
  readonly indexId: IndexId;
  readonly refreshed: boolean;
  /** Set when the provider failed. The stored series is still served. */
  readonly error: string | null;
}

/**
 * Refresh one macro series if it is due, then leave reading to the caller.
 *
 * A provider failure is **reported, never thrown**: `docs/data-sources.md` says
 * serve the last known value with its timestamp visible rather than erroring
 * out, and the UI is what makes that visible. Throwing here would take down a
 * page that could have rendered a slightly old number honestly labelled.
 */
export function makeRefreshIndexSeries(deps: {
  readonly repository: IndexObservationRepository;
  readonly providers: readonly IndexObservationProvider[];
  readonly today: () => Temporal.PlainDate;
}) {
  const { repository, providers, today } = deps;

  return async function refreshIndexSeries(indexId: IndexId): Promise<IndexRefreshReport> {
    const provider = providers.find((candidate) => candidate.indexId === indexId);
    if (provider === undefined) {
      return { indexId, refreshed: false, error: `No provider is registered for ${indexId}` };
    }

    const newest = await repository.latest(indexId);
    if (!isIndexSeriesDue(indexId, newest, today())) {
      return { indexId, refreshed: false, error: null };
    }

    try {
      const observations = await provider.fetchObservations();
      // A provider that validated its input and still found nothing is a
      // changed upstream format, not an empty world — writing nothing is right,
      // and so is saying so.
      if (observations.length === 0) {
        return { indexId, refreshed: false, error: `${provider.name} returned no observations` };
      }
      await repository.save(observations, provider.name as ProviderName);
      return { indexId, refreshed: true, error: null };
    } catch (cause) {
      return {
        indexId,
        refreshed: false,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  };
}
