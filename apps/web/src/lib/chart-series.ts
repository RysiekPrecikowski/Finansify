import { type Direction } from './format';

/**
 * The hero chart tweens from one range to the next, and interpolating two SVG
 * paths requires both to have the same number of points. Every series is
 * therefore resampled to one width on the server before it reaches the chart.
 *
 * This is **display geometry and nothing else**. The high and low labels are
 * formatted from the true series, so no figure the user reads passes through
 * here.
 */
export const chartPointCount = 64;

/**
 * Linear resampling, endpoints exact — used only when the source series is no
 * longer than `count`. Every source point survives on an exact multiple
 * (`resample([0,10,0], 5)` lands the originals on indices 0, 2 and 4), and the
 * shape is preserved because nothing is skipped in this direction.
 */
function upsample(points: readonly number[], count: number): number[] {
  const last = points.length - 1;
  if (last <= 0) return Array.from({ length: count }, () => points[0]!);

  return Array.from({ length: count }, (_unused, index) => {
    // The final index lands exactly on `last`, so both endpoints survive
    // untouched — the chart's direction is read from its first and last value.
    const position = (index / (count - 1)) * last;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, last);
    const fraction = position - lower;

    return points[lower]! + (points[upper]! - points[lower]!) * fraction;
  });
}

/**
 * Largest-Triangle-Three-Buckets: shape-preserving downsampling, chosen for
 * exactly the reason the old linear-only version named as its own future
 * trigger — Phase 2 brought real price series (a `MAX` window can be 200+
 * points) that are longer than `chartPointCount`, and sampling one of those
 * linearly steps straight over spikes a reader would expect to see.
 *
 * Both endpoints are kept untouched, same as `upsample`. Every other output
 * point is the one, in its bucket, that forms the largest triangle with the
 * previously selected point and the *average* of the next bucket — the
 * standard formulation (Sveinn Steinarsson, 2013). `x` is the array index:
 * this function has no notion of dates, only positions in an already-ordered
 * series, which is the same abstraction `upsample` already works at.
 */
function downsampleLTTB(points: readonly number[], count: number): number[] {
  const n = points.length;
  const sampled: number[] = [points[0]!];
  const bucketWidth = (n - 2) / (count - 2);
  let anchor = 0;

  for (let bucket = 0; bucket < count - 2; bucket++) {
    const nextFrom = Math.floor((bucket + 1) * bucketWidth) + 1;
    const nextTo = Math.min(Math.floor((bucket + 2) * bucketWidth) + 1, n);

    let avgX = 0;
    let avgY = 0;
    for (let j = nextFrom; j < nextTo; j++) {
      avgX += j;
      avgY += points[j]!;
    }
    const nextBucketSize = nextTo - nextFrom;
    avgX /= nextBucketSize;
    avgY /= nextBucketSize;

    const from = Math.floor(bucket * bucketWidth) + 1;
    const to = Math.floor((bucket + 1) * bucketWidth) + 1;

    const anchorX = anchor;
    const anchorY = points[anchor]!;

    let maxArea = -1;
    let maxAreaIndex = from;
    for (let j = from; j < to; j++) {
      const area = Math.abs(
        (anchorX - avgX) * (points[j]! - anchorY) - (anchorX - j) * (avgY - anchorY),
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampled.push(points[maxAreaIndex]!);
    anchor = maxAreaIndex;
  }

  sampled.push(points[n - 1]!);
  return sampled;
}

/**
 * Resamples `points` to exactly `count` entries, upsampling (linear, exact
 * endpoints) when the source is no longer than `count` and downsampling
 * (LTTB, shape-preserving) when it is longer. Either direction keeps both
 * endpoints exact, which is what lets the chart read its direction from the
 * first and last value regardless of range.
 */
export function resample(points: readonly number[], count: number): number[] {
  if (count < 2) {
    throw new RangeError(`A chart series needs at least two points, got ${count}`);
  }
  if (points.length === 0) return [];

  return points.length <= count ? upsample(points, count) : downsampleLTTB(points, count);
}

/**
 * One range's worth of chart, precomputed on the server. Every string here is
 * already formatted: `Money` and `Intl` never cross to the client, so
 * formatting still happens only at the edge (apps/web/AGENTS.md).
 */
export interface ChartSeries {
  readonly points: readonly number[];
  readonly direction: Direction;
  readonly highLabel: string;
  readonly lowLabel: string;
  readonly label: string;
}
