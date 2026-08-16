import { Temporal, type IndexObservation } from '@finansify/core';

/**
 * A series as inline SVG. No axes, no tooltip: this is a shape, and the numbers
 * that matter are stated above it in full.
 *
 * Deliberately not in the profit-and-loss colours (`docs/ui.md`) — it uses the
 * neutral chart token. A rate moving is neither good nor bad on its own.
 *
 * Two shapes, because the underlying series genuinely differ:
 *
 * - **`step`** for a macro series. A reference rate holds flat until the RPP
 *   moves it and a CPI print stands for its whole month, so interpolating
 *   between points would draw a change that never happened.
 * - **`line`** for an FX pair. NBP fixes a mid every business day, so the
 *   points are a dense sample of something continuous; stepping them would
 *   claim the rate jumped at midnight and held, which is the less true of the
 *   two readings.
 */
const WIDTH = 320;
const HEIGHT = 48;
const PADDING = 2;

export interface SparklinePoint {
  readonly value: number;
}

export function Sparkline({
  points,
  shape,
}: Readonly<{ points: readonly SparklinePoint[]; shape: 'step' | 'line' }>) {
  // Two points is the minimum that has a shape; one is a dot and reads as noise.
  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const x = (index: number) => PADDING + (index / (values.length - 1)) * (WIDTH - PADDING * 2);
  // A flat series would divide by zero; draw it down the middle instead.
  const y = (value: number) =>
    span === 0 ? HEIGHT / 2 : HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2);

  let path = `M ${x(0)} ${y(values[0] ?? 0)}`;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    if (shape === 'step') {
      // Horizontal to the next date at the old level, then vertical to the new
      // one: the step that actually happened.
      path += ` L ${x(index)} ${y(values[index - 1] ?? 0)}`;
    }
    path += ` L ${x(index)} ${y(value)}`;
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="presentation"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * How far back the macro shape goes.
 *
 * Both series run much longer than this — CPI to 1982, the reference rate to
 * 1998 — and drawing all of it makes the card useless: Poland's 1990 inflation
 * peaked at 1283 against today's 103, so the entire post-2000 series flattens
 * into a straight line under the spike. Ten years is long enough to show a
 * cycle and short enough that the current level is legible.
 *
 * The FX card has no equivalent constant because it has a range picker — the
 * reader chooses the window there instead.
 */
const WINDOW_YEARS = 10;

export function IndicatorSparkline({
  history,
}: Readonly<{ history: readonly IndexObservation[] }>) {
  const newest = history.at(-1);
  if (newest === undefined) return null;

  const from = newest.effectiveFrom.subtract({ years: WINDOW_YEARS });
  const recent = history.filter(
    (observation) => Temporal.PlainDate.compare(observation.effectiveFrom, from) >= 0,
  );

  return (
    <Sparkline
      points={recent.map((observation) => ({ value: Number(observation.value.toFixed(6)) }))}
      shape="step"
    />
  );
}
