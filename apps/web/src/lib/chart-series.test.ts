import { describe, expect, it } from 'vitest';

import { resample, resampleLabels } from './chart-series';

describe('resample', () => {
  it('returns exactly the requested number of points', () => {
    expect(resample([1, 2, 3], 64)).toHaveLength(64);
    expect(resample([1, 2, 3, 4, 5, 6, 7, 8], 5)).toHaveLength(5);
  });

  // The chart reads its direction from the first and last value, so an endpoint
  // that drifts under resampling would turn a gain into a loss.
  it('preserves both endpoints exactly', () => {
    const points = [10, 40, 15, 80, 22];
    const resampled = resample(points, 64);

    expect(resampled[0]).toBe(10);
    expect(resampled[resampled.length - 1]).toBe(22);
  });

  it('keeps a straight line straight', () => {
    const resampled = resample([0, 100], 5);

    expect(resampled).toEqual([0, 25, 50, 75, 100]);
  });

  it('keeps a constant series constant', () => {
    expect(resample([7, 7, 7], 10)).toEqual(Array.from({ length: 10 }, () => 7));
  });

  it('repeats a single point rather than dividing by zero', () => {
    expect(resample([5], 4)).toEqual([5, 5, 5, 5]);
  });

  it('passes every source point through when upsampling an exact multiple', () => {
    // 3 points to 5: the originals land on indices 0, 2 and 4.
    const resampled = resample([0, 10, 0], 5);

    expect(resampled[0]).toBe(0);
    expect(resampled[2]).toBe(10);
    expect(resampled[4]).toBe(0);
  });

  it('rejects a target that cannot describe a line', () => {
    expect(() => resample([1, 2, 3], 1)).toThrow(RangeError);
  });

  it('returns nothing for an empty series', () => {
    expect(resample([], 64)).toEqual([]);
  });

  // Every range is resampled to the same width precisely so the tween can pair
  // point i with point i; if that broke, the animation would silently distort.
  // Lengths both below and above chartPointCount (64) exercise the upsample
  // and downsample paths in the same assertion.
  it('gives every range the same width regardless of source length', () => {
    const widths = [34, 40, 30, 32, 52, 60, 65, 100, 200, 366].map(
      (length) =>
        resample(
          Array.from({ length }, (_unused, index) => index),
          64,
        ).length,
    );

    expect(new Set(widths)).toEqual(new Set([64]));
  });
});

describe('resample downsampling (LTTB)', () => {
  it('produces exactly the target count for long real-shaped sources', () => {
    for (const length of [100, 200, 366]) {
      const points = Array.from({ length }, (_unused, index) => Math.sin(index * 0.3) * 50 + 100);

      expect(resample(points, 64)).toHaveLength(64);
    }
  });

  // Small enough to hand-trace the bucketing: n=10, count=5 gives
  // bucketWidth = (10-2)/(5-2) = 8/3, three middle buckets of source indices
  // [1,2], [3,4,5], [6,7,8]. For a strictly increasing source every triangle
  // area in a bucket is 0 (the points are collinear with the anchor and the
  // next bucket's average), so the tie-break keeps the first index of each
  // bucket: 0, 1, 3, 6, 9.
  it('matches a hand-traced result for a small downsample', () => {
    const points = Array.from({ length: 10 }, (_unused, index) => index);

    expect(resample(points, 5)).toEqual([0, 1, 3, 6, 9]);
  });

  it('preserves both endpoints exactly when downsampling', () => {
    for (const length of [100, 200, 366]) {
      const points = Array.from({ length }, (_unused, index) => Math.sin(index * 0.7) * 30 + 50);
      const resampled = resample(points, 64);

      expect(resampled[0]).toBe(points[0]);
      expect(resampled[resampled.length - 1]).toBe(points[length - 1]);
    }
  });

  it('keeps a single sharp spike visible after downsampling', () => {
    const length = 200;
    const baseline = 100;
    const spikeIndex = 83;
    const spikeValue = 10_000;
    const points = Array.from({ length }, (_unused, index) =>
      index === spikeIndex ? spikeValue : baseline,
    );

    const resampled = resample(points, 64);

    // LTTB doesn't promise it lands exactly on spikeIndex — only that,
    // within the spike's own bucket, the spike point maximizes triangle area
    // against the previous selected point and the next bucket's average, so
    // some point from that bucket beats every flat neighbour. With 200
    // source points downsampled to 64, each bucket spans ~3 points, so the
    // spike's bucket has no flat point that comes remotely close to its
    // area. 10x baseline is comfortably below the spike (100x baseline) and
    // comfortably above anything a smoothed flat run (~100) could produce.
    expect(Math.max(...resampled)).toBeGreaterThan(baseline * 10);
  });

  // Not a strict LTTB requirement, just a sanity check: bucket ranges are
  // contiguous and strictly advancing (see chart-series.ts), so for a
  // strictly increasing source the selected indices strictly increase too,
  // and the values follow. Kept as a loose non-decreasing check rather than
  // asserting exact indices, since those are already pinned by the
  // hand-traced test above.
  it('stays monotonic-ish for a smooth strictly-increasing series', () => {
    const length = 366;
    const points = Array.from({ length }, (_unused, index) => index);

    const resampled = resample(points, 64);

    expect(resampled[0]).toBe(points[0]);
    expect(resampled[resampled.length - 1]).toBe(points[length - 1]);
    for (let index = 1; index < resampled.length; index++) {
      expect(resampled[index]).toBeGreaterThanOrEqual(resampled[index - 1]!);
    }
  });

  // The exact point where resample's dispatch flips from upsample to
  // downsampleLTTB: one source point more than the target count.
  it('handles the boundary one point past the upsample path (65 -> 64)', () => {
    const points = Array.from({ length: 65 }, (_unused, index) => index);
    const resampled = resample(points, 64);

    expect(resampled).toHaveLength(64);
    expect(resampled[0]).toBe(points[0]);
    expect(resampled[resampled.length - 1]).toBe(points[64]);
  });
});

describe('resampleLabels', () => {
  it('returns exactly the requested count and preserves both endpoints', () => {
    const dates = Array.from({ length: 200 }, (_unused, index) => `day-${index}`);
    const labels = resampleLabels(dates, 64);

    expect(labels).toHaveLength(64);
    expect(labels[0]).toBe('day-0');
    expect(labels[labels.length - 1]).toBe('day-199');
  });

  it('never invents a label past what the source actually has', () => {
    const dates = ['day-0', 'day-1', 'day-2'];
    const labels = resampleLabels(dates, 5);

    for (const label of labels) {
      expect(dates).toContain(label);
    }
  });

  it('repeats the single source label rather than dividing by zero', () => {
    expect(resampleLabels(['only'], 4)).toEqual(['only', 'only', 'only', 'only']);
  });

  it('returns nothing for an empty source', () => {
    expect(resampleLabels([], 64)).toEqual([]);
  });
});
