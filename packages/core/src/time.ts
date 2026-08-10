import { Temporal } from 'temporal-polyfill';

/**
 * All timestamps crossing a module boundary are ISO-8601 strings in UTC.
 * They're parsed into `Temporal.Instant` for comparison -- never into `Date`,
 * which serializes inconsistently between server and client and parses
 * non-ISO input inconsistently across engines.
 */
export function toInstant(timestamp: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(timestamp);
  } catch {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }
}

/** Whether `timestamp` is at or before `asOf`. */
export function isAtOrBefore(timestamp: string, asOf: string): boolean {
  return Temporal.Instant.compare(toInstant(timestamp), toInstant(asOf)) <= 0;
}

/**
 * Returns the most recent entry at or before `asOf`, or undefined if none exists.
 *
 * This is the shared "nearest prior observation" primitive behind the missing-data
 * fallback policy for both prices and FX (docs/domain.md).
 */
export function findLatestAtOrBefore<T>(
  points: readonly T[],
  asOf: string,
  getObservedAt: (point: T) => string,
  matches: (point: T) => boolean,
): T | undefined {
  const asOfInstant = toInstant(asOf);
  let best: T | undefined;
  let bestInstant: Temporal.Instant | undefined;

  for (const point of points) {
    if (!matches(point)) continue;

    const instant = toInstant(getObservedAt(point));
    if (
      Temporal.Instant.compare(instant, asOfInstant) <= 0 &&
      (bestInstant === undefined || Temporal.Instant.compare(instant, bestInstant) > 0)
    ) {
      best = point;
      bestInstant = instant;
    }
  }

  return best;
}
