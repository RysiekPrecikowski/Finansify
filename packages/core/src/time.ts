/**
 * All timestamps crossing a module boundary are ISO-8601 strings in UTC.
 * Dates are never passed around as `Date` -- they serialize inconsistently
 * between server and client, and we compare them across FX and price series.
 */
export function toEpochMilliseconds(timestamp: string): number {
  const epoch = Date.parse(timestamp);

  if (Number.isNaN(epoch)) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }

  return epoch;
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
  const asOfEpoch = toEpochMilliseconds(asOf);
  let best: T | undefined;
  let bestEpoch = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!matches(point)) continue;

    const epoch = toEpochMilliseconds(getObservedAt(point));
    if (epoch <= asOfEpoch && epoch > bestEpoch) {
      best = point;
      bestEpoch = epoch;
    }
  }

  return best;
}
