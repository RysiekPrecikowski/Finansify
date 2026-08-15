import { Temporal, type IndexObservation } from '@finansify/core';

/**
 * The series as a step chart, drawn as inline SVG.
 *
 * A step rather than a line because both series *are* steps: a reference rate
 * holds flat until the RPP moves it, and a CPI print stands for its whole
 * month. Interpolating between points would draw a change that never happened.
 *
 * Deliberately not in the profit-and-loss colours (`docs/ui.md`) — it uses the
 * neutral chart token. No axes, no tooltip: this is a shape, and the numbers
 * that matter are stated above it in full.
 */
const WIDTH = 320;
const HEIGHT = 48;
const PADDING = 2;

/**
 * How far back the shape goes.
 *
 * Both series run much longer than this — CPI to 1982, the reference rate to
 * 1998 — and drawing all of it makes the card useless: Poland's 1990 inflation
 * peaked at 1283 against today's 103, so the entire post-2000 series flattens
 * into a straight line under the spike. Ten years is long enough to show a
 * cycle and short enough that the current level is legible.
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

  // Two points is the minimum that has a shape; one is a dot and reads as noise.
  if (recent.length < 2) return null;

  const values = recent.map((observation) => Number(observation.value.toFixed(6)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const x = (index: number) => PADDING + (index / (recent.length - 1)) * (WIDTH - PADDING * 2);
  // A flat series would divide by zero; draw it down the middle instead.
  const y = (value: number) =>
    span === 0 ? HEIGHT / 2 : HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2);

  let path = `M ${x(0)} ${y(values[0] ?? 0)}`;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    // Horizontal to the next date at the old level, then vertical to the new
    // one: the step that actually happened.
    path += ` L ${x(index)} ${y(values[index - 1] ?? 0)} L ${x(index)} ${y(value)}`;
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
