import { describe, expect, it } from 'vitest';

import { resample } from './chart-series';

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
  it('gives every range the same width regardless of source length', () => {
    const widths = [34, 40, 30, 32, 52, 60].map(
      (length) =>
        resample(
          Array.from({ length }, (_unused, index) => index),
          64,
        ).length,
    );

    expect(new Set(widths)).toEqual(new Set([64]));
  });
});
