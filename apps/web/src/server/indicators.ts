import {
  makeRefreshIndexSeries,
  summarizeIndexSeries,
  Temporal,
  type IndexId,
  type IndexObservation,
  type IndexSummary,
} from '@finansify/core';

import {
  clock,
  getCpiProvider,
  getIndexObservations,
  getReferenceRateProvider,
} from '@/server/container';

export interface IndicatorSeries {
  readonly summary: IndexSummary | null;
  /** Oldest first, for the chart. */
  readonly history: readonly IndexObservation[];
  /** Set when a refresh was attempted and failed; the stored series is still shown. */
  readonly error: string | null;
}

const displayTimeZone = 'Europe/Warsaw';

/**
 * Read a macro series, refreshing it first if it is due.
 *
 * **Deliberately not keyed by user, and it must stay that way.** Rule 5 exists
 * so a cache entry over *user* data carries the user id; these two series are
 * facts about Poland, identical for everyone (ADR 0010). Adding a user id here
 * would leak nothing — it would just refetch GUS once per account and throw
 * away the sharing that makes the free tiers viable. There is deliberately no
 * `userId` parameter on this function so the mistake cannot be made quietly.
 *
 * No scheduler either (`architecture.md`): the read performs its own
 * stale-while-revalidate check, and the `<Suspense>` boundary that calls it is
 * the only thing on the page waiting for a network hop.
 */
export async function readIndicatorSeries(indexId: IndexId): Promise<IndicatorSeries> {
  const repository = getIndexObservations();

  const refresh = makeRefreshIndexSeries({
    repository,
    providers: [getReferenceRateProvider(), getCpiProvider()],
    today: () => clock.now().toZonedDateTimeISO(displayTimeZone).toPlainDate(),
  });

  const report = await refresh(indexId);
  const history = await repository.history(indexId);

  return {
    summary: summarizeIndexSeries(indexId, history),
    history,
    error: report.error,
  };
}

export async function readAllIndicators(): Promise<readonly IndicatorSeries[]> {
  // Two independent series and two independent upstreams — no reason to make
  // the slower one wait for the faster.
  return Promise.all(
    (['nbp_reference', 'pl_cpi_yoy'] as const satisfies readonly IndexId[]).map(
      readIndicatorSeries,
    ),
  );
}

export { Temporal };
