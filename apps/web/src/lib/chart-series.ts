import { type Direction } from './format';

/**
 * The hero chart tweens from one range to the next, and interpolating two SVG
 * paths requires both to have the same number of points — the fixture's ranges
 * have 34, 40, 30, 32, 52 and 60. Every series is therefore resampled to one
 * width on the server before it reaches the chart.
 *
 * This is **display geometry and nothing else**. The high and low labels are
 * formatted from the true series, so no figure the user reads passes through
 * here.
 */
export const chartPointCount = 64;

/**
 * Linear resampling, endpoints exact. Deliberately chosen while every source
 * series is shorter than `chartPointCount` and this only ever upsamples: the
 * shape is preserved because no source point is skipped.
 *
 * Phase 2 brings real price series that are far longer than the target, and
 * sampling one of those linearly would step straight over spikes. That is the
 * point to switch to something shape-preserving (LTTB) — not now, when it
 * would be untestable guesswork against data that does not exist yet.
 */
export function resample(points: readonly number[], count: number): number[] {
  if (count < 2) {
    throw new RangeError(`A chart series needs at least two points, got ${count}`);
  }
  if (points.length === 0) return [];

  const last = points.length - 1;
  if (last === 0) return Array.from({ length: count }, () => points[0]!);

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
