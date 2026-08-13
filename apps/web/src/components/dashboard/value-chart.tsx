'use client';

import { useEffect, useId, useRef, useState } from 'react';

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
  readonly direction: Direction;
  readonly highLabel: string;
  readonly lowLabel: string;
  readonly label: string;
  /**
   * Changes when the series does. The tween keys off this rather than array
   * identity, which a re-render would break without the data having moved.
   */
  readonly seriesKey: string;
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

function scale(points: readonly number[]): { xs: number[]; ys: number[] } {
  const high = Math.max(...points);
  const low = Math.min(...points);
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
  direction,
  highLabel,
  lowLabel,
  label,
  seriesKey,
}: ValueChartProps) {
  const gradientId = useId();
  const tweened = useTweenedPoints(points, seriesKey);

  if (tweened.length < 2) return null;

  const { xs, ys } = scale(tweened);
  const line = xs.map((x, index) => `${index === 0 ? 'M' : 'L'}${x} ${ys[index]}`).join(' ');
  const area = `${line} L${viewWidth} ${viewHeight} L0 ${viewHeight} Z`;

  return (
    <figure className="relative">
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
            non-uniform scaling that makes the chart fill its box. */}
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
          y1={Math.max(...ys)}
          y2={Math.max(...ys)}
          stroke="currentColor"
          strokeDasharray="2 6"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="text-border"
        />

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
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
          key={`low-${seriesKey}`}
          className="text-muted-foreground bg-background/60 animate-in fade-in ml-auto rounded px-1 text-xs tabular-nums duration-300"
        >
          {lowLabel}
        </span>
      </figcaption>
    </figure>
  );
}
