'use client';

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { type Direction } from '@/lib/format';

/**
 * The hero chart, as inline SVG. It still renders on the server and arrives in
 * the first paint with no layout shift — the client boundary exists only so a
 * range change can be animated rather than swapped underneath the reader.
 *
 * `lightweight-charts` takes over in Phase 2 (docs/ui.md), when there are real
 * bars to pan and zoom through and a granularity toggle to honour. Worth
 * knowing before then: it does not animate a series swap either, so the tween
 * below is the part that will need re-solving inside the canvas rather than
 * something the library hands over.
 */
export interface ValueChartProps {
  /** Plain numbers: pixel geometry, not money. The labels carry the money. */
  readonly points: readonly number[];
  /**
   * How many leading points are still `partial` (backfill hasn't reached that
   * date yet) — that prefix of the line renders dashed at reduced opacity, so
   * a chart that's still loading its left edge looks like it, rather than
   * like a real (and wrong) flat run. `0` draws entirely solid.
   */
  readonly partialBoundary: number;
  readonly direction: Direction;
  readonly highLabel: string;
  readonly lowLabel: string;
  /** Third y-axis reference line, between high and low. */
  readonly midLabel: string;
  /**
   * One formatted date and value per entry in `points`, for the x-axis ticks
   * and the hover tooltip. Same length as `points`; index `i` here always
   * describes index `i` there.
   */
  readonly dateLabels: readonly string[];
  readonly valueLabels: readonly string[];
  readonly label: string;
  /**
   * Changes when the series does. The tween keys off this rather than array
   * identity, which a re-render would break without the data having moved.
   */
  readonly seriesKey: string;
  /**
   * The benchmark overlay, already normalized onto the portfolio's own scale
   * (`lib/dashboard/benchmarks.ts`) and the same length as `points`. Empty
   * draws nothing. Dashed and in `--brand`, never in gain/loss green or red:
   * an index has no profit and loss of its own to colour (docs/ui.md).
   */
  readonly benchmarkPoints?: readonly number[];
  /** Legend text. Both required for the legend to render at all. */
  readonly portfolioLabel?: string;
  readonly benchmarkLabel?: string;
}

const viewWidth = 1000;
const viewHeight = 240;
const padding = 16;
const tweenMs = 350;

/**
 * Two decimals inside a 1000-unit viewBox is far below a device pixel, and the
 * `d` attribute is rebuilt on every animation frame — full float precision
 * spends ~36 characters per point to describe a position no one can see.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stable identity for "no benchmark", so the tween hook below isn't handed a new array every render. */
const noPoints: readonly number[] = [];

/**
 * `domain` is what sets the y-scale, `points` is what gets positioned in it —
 * the same call twice with one shared domain is what puts the portfolio and
 * the benchmark on **one** scale rather than two that happen to overlap.
 * `xs` spans the full width for whichever series it is given, which is only
 * correct because both arrive resampled to the same length.
 */
function scale(
  points: readonly number[],
  domain: readonly number[],
): { xs: number[]; ys: number[] } {
  const high = Math.max(...domain);
  const low = Math.min(...domain);
  const span = high - low || 1;
  const usable = viewHeight - padding * 2;

  return {
    xs: points.map((_unused, index) => round((index / Math.max(points.length - 1, 1)) * viewWidth)),
    ys: points.map((value) => round(padding + (1 - (value - low) / span) * usable)),
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);

    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}

/**
 * Interpolates the **values**, not the finished path, so the y-axis domain
 * travels with the shape instead of the line sliding around inside a scale
 * that already jumped. Every series arrives resampled to the same width
 * (`lib/chart-series.ts`), which is what lets point *i* pair with point *i*.
 */
function useTweenedPoints(target: readonly number[], seriesKey: string): readonly number[] {
  const reducedMotion = usePrefersReducedMotion();
  const [displayed, setDisplayed] = useState(target);
  const shownKey = useRef(seriesKey);
  const from = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (shownKey.current === seriesKey) {
      // Same range, a different array: a server re-render (a chip, a sort), not
      // a switch. React has already run this effect's cleanup, so returning
      // here would leave a running tween cancelled and never restarted — and
      // `displayed` holding values the server has since replaced. Adopt them
      // instead; there is nothing to animate between two renders of one range.
      if (from.current !== target) {
        from.current = target;
        setDisplayed(target);
      }
      return;
    }
    shownKey.current = seriesKey;

    if (reducedMotion) {
      from.current = target;
      setDisplayed(target);
      return;
    }

    // Whatever is on screen right now, which mid-tween is not the previous
    // range — switching twice quickly continues from the current frame rather
    // than snapping back to start.
    const start = from.current;
    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / tweenMs, 1);

      // The last frame takes the target itself rather than computing it.
      // `previous + (value - previous) * 1` is not reliably `value` in floating
      // point, and settling a hair off the target would leave the client
      // holding a shape the server would never have rendered.
      if (progress === 1) {
        from.current = target;
        setDisplayed(target);
        return;
      }

      const eased = 1 - (1 - progress) ** 3;
      const next = target.map((value, index) => {
        const previous = start[index] ?? value;
        return previous + (value - previous) * eased;
      });

      from.current = next;
      setDisplayed(next);
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [seriesKey, target, reducedMotion]);

  return displayed;
}

export function ValueChart({
  points,
  partialBoundary,
  direction,
  highLabel,
  lowLabel,
  midLabel,
  dateLabels,
  valueLabels,
  label,
  seriesKey,
  benchmarkPoints = noPoints,
  portfolioLabel,
  benchmarkLabel,
}: ValueChartProps) {
  const gradientId = useId();
  const tweened = useTweenedPoints(points, seriesKey);
  // Its own tween on the same key: the two lines have to travel together, or a
  // range switch would slide the portfolio into a scale the benchmark has
  // already jumped to.
  const tweenedBenchmark = useTweenedPoints(benchmarkPoints, seriesKey);
  const figureRef = useRef<HTMLElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Hooks above this line run every render regardless of `tweened.length`,
  // same reason the tween effect itself never returns early on it.
  if (tweened.length < 2) return null;

  function updateHover(clientX: number): void {
    const rect = figureRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    setHoverIndex(Math.round(ratio * (tweened.length - 1)));
  }

  // One shared domain for both series (see `scale`). A benchmark that ran
  // above or below everything the portfolio did still fits, and the portfolio
  // never silently rescales to hide it.
  const hasBenchmark = tweenedBenchmark.length === tweened.length && tweened.length >= 2;
  const domain = hasBenchmark ? [...tweened, ...tweenedBenchmark] : tweened;

  const { xs, ys } = scale(tweened, domain);
  const benchmarkYs = hasBenchmark ? scale(tweenedBenchmark, domain).ys : null;
  const benchmarkLine =
    benchmarkYs === null
      ? null
      : xs.map((x, index) => `${index === 0 ? 'M' : 'L'}${x} ${benchmarkYs[index]}`).join(' ');
  const line = xs.map((x, index) => `${index === 0 ? 'M' : 'L'}${x} ${ys[index]}`).join(' ');
  const area = `${line} L${viewWidth} ${viewHeight} L0 ${viewHeight} Z`;

  // Clamped so a stale prop (a resample width that briefly disagrees with the
  // tween's own length) can never index past either end. The two segments
  // share point `boundary` as a seam, so the line never visibly breaks.
  const boundary = Math.max(0, Math.min(partialBoundary, tweened.length - 1));
  const pathFrom = (from: number, to: number) =>
    xs
      .slice(from, to + 1)
      .map((x, index) => `${index === 0 ? 'M' : 'L'}${x} ${ys[from + index]}`)
      .join(' ');
  const dashedPrefix = boundary > 0 ? pathFrom(0, boundary) : null;
  const solidSuffix = boundary < tweened.length - 1 ? pathFrom(boundary, tweened.length - 1) : null;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;

  // Three evenly spread x-axis ticks. `tweened.length` is always
  // `chartPointCount` in practice, so these never collide.
  const tickIndices = [0, Math.round((tweened.length - 1) / 2), tweened.length - 1];

  const hoverPoint =
    hoverIndex !== null
      ? {
          x: xs[hoverIndex]!,
          y: ys[hoverIndex]!,
          date: dateLabels[hoverIndex],
          value: valueLabels[hoverIndex],
        }
      : null;
  // Flip the tooltip's horizontal anchor near either edge so it never renders
  // partly off the figure.
  const leftPct = hoverPoint !== null ? (hoverPoint.x / viewWidth) * 100 : 0;
  const anchor = leftPct < 20 ? 'start' : leftPct > 80 ? 'end' : 'center';
  const anchorTranslateX = anchor === 'start' ? '0%' : anchor === 'end' ? '-100%' : '-50%';

  function clearHover(): void {
    setHoverIndex(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <figure
        ref={figureRef}
        className="relative touch-none"
        onPointerMove={(event: ReactPointerEvent<HTMLElement>) => updateHover(event.clientX)}
        onPointerDown={(event: ReactPointerEvent<HTMLElement>) => updateHover(event.clientX)}
        onPointerUp={clearHover}
        onPointerCancel={clearHover}
        onPointerLeave={clearHover}
      >
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          // One `color` drives both the line and the gradient, so a range whose
          // direction differs cross-fades instead of snapping between green and
          // red. The dashed bounds set their own colour and are unaffected.
          style={{ color: direction === 'down' ? 'var(--loss)' : 'var(--gain)' }}
          className="h-40 w-full transition-colors duration-300 sm:h-56"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* `non-scaling-stroke` keeps widths and dash patterns honest under the
              non-uniform scaling that makes the chart fill its box. Three lines,
              not two: high/low/mid is the y-scale a reader can actually place a
              value against. */}
          <line
            x1="0"
            x2={viewWidth}
            y1={Math.min(...ys)}
            y2={Math.min(...ys)}
            stroke="currentColor"
            strokeDasharray="2 6"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="text-border"
          />
          <line
            x1="0"
            x2={viewWidth}
            y1={midY}
            y2={midY}
            stroke="currentColor"
            strokeDasharray="2 6"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="text-border"
          />
          <line
            x1="0"
            x2={viewWidth}
            y1={Math.max(...ys)}
            y2={Math.max(...ys)}
            stroke="currentColor"
            strokeDasharray="2 6"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="text-border"
          />

          <path d={area} fill={`url(#${gradientId})`} />

          {/* The benchmark, under the portfolio line and after the area fill so
              the gradient never washes it out. `--brand`, the one second accent
              (globals.css) — green and red stay reserved for profit and loss,
              and an index has neither. */}
          {benchmarkLine !== null && (
            <path
              d={benchmarkLine}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="5 4"
              strokeOpacity="0.85"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Still-loading history: dashed, at reduced opacity, so a chart with
              an unbackfilled left edge reads as "loading" rather than as a real
              (and wrong) flat run at zero. */}
          {dashedPrefix !== null && (
            <path
              d={dashedPrefix}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="6 5"
              strokeOpacity="0.45"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {solidSuffix !== null && (
            <path
              d={solidSuffix}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {hoverPoint !== null && (
            <>
              <line
                x1={hoverPoint.x}
                x2={hoverPoint.x}
                y1="0"
                y2={viewHeight}
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                className="text-muted-foreground"
              />
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r="4"
                fill="currentColor"
                stroke="var(--background)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* Labels sit in HTML, not in the SVG: text inside a non-uniformly scaled
            viewBox stretches. Keyed on the range so a new pair fades in rather
            than the digits changing under the reader mid-tween. */}
        <figcaption className="pointer-events-none absolute inset-0 flex flex-col justify-between py-1 text-right">
          <span
            key={`high-${seriesKey}`}
            className="text-muted-foreground bg-background/60 animate-in fade-in ml-auto rounded px-1 text-xs tabular-nums duration-300"
          >
            {highLabel}
          </span>
          <span
            key={`mid-${seriesKey}`}
            className="text-muted-foreground/70 bg-background/60 animate-in fade-in ml-auto rounded px-1 text-[10px] tabular-nums duration-300"
          >
            {midLabel}
          </span>
          <span
            key={`low-${seriesKey}`}
            className="text-muted-foreground bg-background/60 animate-in fade-in ml-auto rounded px-1 text-xs tabular-nums duration-300"
          >
            {lowLabel}
          </span>
        </figcaption>

        {hoverPoint !== null && (
          <div
            className="bg-foreground text-background pointer-events-none absolute z-10 flex flex-col items-center gap-0.5 rounded-md px-2 py-1 shadow-md"
            style={{
              left: `${leftPct}%`,
              top: `${(hoverPoint.y / viewHeight) * 100}%`,
              transform: `translate(${anchorTranslateX}, calc(-100% - 10px))`,
            }}
          >
            <span className="text-xs font-medium tabular-nums">{hoverPoint.value}</span>
            <span className="text-background/70 text-[10px] tabular-nums">{hoverPoint.date}</span>
          </div>
        )}
      </figure>

      {/* The x-scale: first, middle and last plotted date. `aria-hidden` — the
          same dates are already implied by the range tabs below, this is a
          sighted-reader convenience, not new information. */}
      <div
        className="text-muted-foreground flex justify-between px-0.5 text-[10px] tabular-nums"
        aria-hidden="true"
      >
        {tickIndices.map((index, position) => (
          <span key={position}>{dateLabels[index]}</span>
        ))}
      </div>

      {/* Which line is which. Drawn as two short SVG rules rather than as
          coloured dots, so the dash pattern itself is what distinguishes them —
          the same thing the reader is matching against on the chart. */}
      {benchmarkLine !== null && portfolioLabel !== undefined && benchmarkLabel !== undefined && (
        <div className="text-muted-foreground mt-1 flex items-center gap-4 text-[0.6875rem]">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="2" viewBox="0 0 16 2" aria-hidden="true">
              <line
                x1="0"
                y1="1"
                x2="16"
                y2="1"
                stroke={direction === 'down' ? 'var(--loss)' : 'var(--gain)'}
                strokeWidth="2"
              />
            </svg>
            {portfolioLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="2" viewBox="0 0 16 2" aria-hidden="true">
              <line
                x1="0"
                y1="1"
                x2="16"
                y2="1"
                stroke="var(--brand)"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            </svg>
            {benchmarkLabel}
          </span>
        </div>
      )}
    </div>
  );
}
