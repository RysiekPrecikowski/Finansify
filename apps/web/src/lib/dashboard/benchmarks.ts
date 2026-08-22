/**
 * The hero chart's benchmark overlay — **synthetic for now**, and labelled as
 * such wherever it is drawn.
 *
 * `docs/ui.md` has always described this row as "a benchmark overlay toggle
 * [that] draws WIG, a world ETF, or the S&P 500 as a normalized second
 * series", and `docs/domain.md` says benchmarks are "just instruments with a
 * price series". Neither exists yet: no provider in `packages/providers`
 * fetches an index level, and `market_prices` has no rows for one. Rather than
 * leave the chart without the comparison the design is built around, this
 * module generates a plausible index path — the same stance
 * `lib/dashboard/demo-enrichment.ts` already takes for per-symbol sectors and
 * day changes, and `components/dashboard/news-list.tsx` for headlines.
 *
 * Two properties make that safe to ship:
 *
 * - **Deterministic.** A seeded PRNG keyed on the benchmark and the range, never
 *   `Math.random()` — a server render and the client render that follows it
 *   agree, so there is no hydration mismatch and no number that changes under
 *   the reader on a re-render.
 * - **Visibly not real.** The line is dashed, the legend names it, and the
 *   selector's own note (`dashboard.benchmark.demo`) says it is illustrative.
 *   Rule 7 is about never passing an estimate off as a measurement; this never
 *   claims to be one.
 *
 * When a real index series lands, `buildBenchmarkSeries` is the one function to
 * replace — everything above it consumes plain numbers already normalized to
 * the portfolio's own scale.
 */

export const benchmarks = ['wig20tr', 'msciWorld', 'sp500'] as const;
export type Benchmark = (typeof benchmarks)[number];

export const defaultBenchmark: Benchmark = 'wig20tr';

/**
 * Per-benchmark shape: a total drift across the whole window and a per-step
 * amplitude. Loosely ordered the way these three actually behave — WIG20TR
 * choppier and flatter, MSCI World smoothest, the S&P in between — so the
 * three options look different from each other rather than being one curve
 * with three names.
 */
const profiles: Record<Benchmark, { readonly drift: number; readonly amplitude: number }> = {
  wig20tr: { drift: 0.031, amplitude: 0.011 },
  msciWorld: { drift: 0.048, amplitude: 0.006 },
  sp500: { drift: 0.062, amplitude: 0.009 },
};

/** djb2-ish, the same small stable hash `demo-enrichment.ts` uses — not cryptographic, just deterministic. */
function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** mulberry32: one seed in, a repeatable `[0, 1)` sequence out. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The index path itself, normalized to start at `1`. Separate from the scaling
 * below because the percentage tiles want the ratio, not the currency figure.
 */
export function benchmarkIndexPath(
  benchmark: Benchmark,
  rangeKey: string,
  length: number,
): readonly number[] {
  if (length <= 0) return [];

  const profile = profiles[benchmark];
  const random = seededRandom(hashString(`${benchmark}:${rangeKey}`));
  const perStep = length > 1 ? profile.drift / (length - 1) : 0;

  const path: number[] = [1];
  for (let index = 1; index < length; index += 1) {
    const noise = (random() - 0.5) * 2 * profile.amplitude;
    // Clamped well away from zero: a long window with an unlucky seed must
    // never walk the line into or through the x-axis, which would read as an
    // index losing all its value.
    path.push(Math.max(path[index - 1]! * (1 + perStep + noise), 0.2));
  }
  return path;
}

/**
 * The benchmark drawn on the portfolio's own y-scale — "a normalized second
 * series" in `docs/ui.md`'s words: both lines start at the same point, so what
 * the reader compares is the *shape*, which is the only comparison that means
 * anything between a złoty figure and an index level.
 *
 * Anchored on the first non-zero portfolio value rather than on `points[0]`:
 * a portfolio whose window opens before its first transaction starts at zero,
 * and anchoring there would multiply the whole index path by nothing.
 */
export function buildBenchmarkSeries(
  portfolio: readonly number[],
  benchmark: Benchmark,
  rangeKey: string,
): readonly number[] {
  if (portfolio.length < 2) return [];

  const base = portfolio.find((value) => value > 0) ?? Math.max(...portfolio, 1);
  return benchmarkIndexPath(benchmark, rangeKey, portfolio.length).map((factor) => base * factor);
}

/**
 * A benchmark's return over the window, as the ratio string
 * `formatRatioAsPercent` expects. Read off the index path directly, so it is
 * unaffected by whatever the portfolio happened to be worth.
 */
export function benchmarkReturn(
  benchmark: Benchmark,
  rangeKey: string,
  length: number,
): string | null {
  const path = benchmarkIndexPath(benchmark, rangeKey, length);
  const last = path.at(-1);
  if (last === undefined || path.length < 2) return null;
  return (last - 1).toFixed(6);
}

/**
 * The portfolio's return over the same window, from the series the chart is
 * drawing. `null` when the window opens at zero — a portfolio that started
 * from nothing has no percentage return, and `Infinity` is not a figure to put
 * on screen (rule 7's spirit: no number is better than a wrong one).
 *
 * These are plain numbers, not `Decimal`s: `Money` never crosses to the client
 * (`lib/hero-series.ts`), and the inputs here are already the doubles the SVG
 * is scaled from. Two decimal places of a percentage is far inside what that
 * costs.
 */
export function seriesReturn(values: readonly number[]): string | null {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || first <= 0) return null;
  return (last / first - 1).toFixed(6);
}

/** Portfolio minus benchmark, in ratio terms — the "Różnica" tile. `null` if either side has no figure. */
export function returnDifference(
  portfolio: string | null,
  benchmark: string | null,
): string | null {
  if (portfolio === null || benchmark === null) return null;
  return (Number(portfolio) - Number(benchmark)).toFixed(6);
}
