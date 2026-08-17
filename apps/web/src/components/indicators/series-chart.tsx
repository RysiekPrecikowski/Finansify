'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { intlLocale, type Locale } from '@/lib/i18n/locales';

export interface SeriesPoint {
  /** ISO `YYYY-MM-DD`. Kept as a string so the server can hand these straight over. */
  readonly date: string;
  readonly value: number;
}

/**
 * One series over time, with the axes and the hover readout a sparkline
 * deliberately left out.
 *
 * The shape argument is not decoration. A reference rate holds flat until the
 * RPP moves it and a CPI print stands for its whole month, so those are drawn
 * as **steps** — a slope between two prints would draw a change that never
 * happened. An FX mid is fixed every business day, a dense sample of something
 * continuous, so that one is a **line**.
 *
 * Dates are spaced by index, not by calendar distance: table A skips weekends
 * and holidays, and spacing by real time would draw a flat weekend segment on
 * every chart, which is a gap the data does not claim to fill (rule 7).
 */
export function SeriesChart({
  points,
  shape,
  format,
  locale,
  label,
}: Readonly<{
  points: readonly SeriesPoint[];
  shape: 'line' | 'step';
  /** `rate` is an FX mid at four decimals; `percent` is a fraction rendered as one. */
  format: 'rate' | 'percent';
  locale: Locale;
  /** Names the series for a screen reader — the card's heading, in words. */
  label: string;
}>) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  // Real pixels rather than a scaled viewBox: a `preserveAspectRatio` box
  // scales its text with the plot, so the same chart renders 11px type in a
  // narrow card and 18px in a wide one.
  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const formatValue = useCallback(
    (value: number) =>
      format === 'rate'
        ? new Intl.NumberFormat(intlLocale[locale], {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          }).format(value)
        : new Intl.NumberFormat(intlLocale[locale], {
            style: 'percent',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(value),
    [format, locale],
  );

  const formatDate = useCallback(
    (iso: string, style: DateStyle) =>
      new Intl.DateTimeFormat(intlLocale[locale], dateOptions[style]).format(
        new Date(`${iso}T12:00:00Z`),
      ),
    [locale],
  );

  // Three ticks over a month all land in the same month or two, so a month-and-
  // year tick prints the same label twice and the axis stops saying anything.
  // Driven by the span the points actually cover rather than by the range that
  // asked for them: this chart never sees the range, and the two indicator
  // cards have no range at all.
  const tickStyle = useMemo(() => tickStyleFor(points), [points]);

  const geometry = useMemo(() => build(points, width, shape), [points, width, shape]);

  if (points.length < 2 || geometry === null) {
    return <div ref={wrapper} className="h-40 w-full" />;
  }

  const { path, x, y, min, max, mid, plot, drawn } = geometry;
  const active = cursor === null ? undefined : points[cursor];

  const onPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left - plot.left;
    const ratio = Math.min(Math.max(offset / plot.width, 0), 1);
    setCursor(Math.round(ratio * (points.length - 1)));
  };

  const move = (step: number) => {
    setCursor((current) => {
      const next = (current ?? points.length - 1) + step;
      return Math.min(Math.max(next, 0), points.length - 1);
    });
  };

  return (
    <div ref={wrapper} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          className="touch-none"
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerLeave={() => {
            setCursor(null);
          }}
          onBlur={() => {
            setCursor(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(1);
            else if (event.key === 'ArrowLeft') move(-1);
            else return;
            event.preventDefault();
          }}
        >
          {/* Gridlines: hairline, one step off the surface, never competing with
              the series. Three is enough to read a level off — top, middle,
              bottom — and a fourth starts to look like data. */}
          {[max, mid, min].map((value) => (
            <g key={value}>
              <line
                x1={plot.left}
                x2={plot.left + plot.width}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={plot.left - 6}
                y={y(value)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[0.65rem] tabular-nums"
              >
                {formatValue(value)}
              </text>
            </g>
          ))}

          {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) => (
            <text
              key={index}
              x={x(index)}
              y={HEIGHT - 4}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[0.65rem] tabular-nums"
            >
              {formatDate(points[index]!.date, tickStyle)}
            </text>
          ))}

          <path
            d={path}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {cursor !== null && active !== undefined && (
            <>
              <line
                x1={x(cursor)}
                x2={x(cursor)}
                y1={plot.top}
                y2={plot.top + plot.height}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              />
              {/* A 2px surface ring keeps the dot legible where it sits on the
                  line it is marking. */}
              <circle
                cx={x(cursor)}
                cy={y(active.value)}
                r={4}
                fill="var(--chart-1)"
                stroke="var(--background)"
                strokeWidth={2}
              />
            </>
          )}
        </svg>
      )}

      {/* Value leads, date follows — the reader already has the series from the
          card heading and wants the number. */}
      {active !== undefined && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute top-0 rounded-md border px-2 py-1 text-xs shadow-sm"
          style={{
            left: Math.min(Math.max(x(cursor ?? 0) - 40, 0), Math.max(width - 96, 0)),
          }}
        >
          <span className="font-semibold tabular-nums">{formatValue(active.value)}</span>
          <span className="text-muted-foreground ml-1.5 tabular-nums">
            {formatDate(active.date, 'full')}
          </span>
        </div>
      )}

      <span className="sr-only">
        {drawn < points.length
          ? `${points.length} points, drawn at ${drawn} columns`
          : `${points.length} points`}
      </span>
    </div>
  );
}

const HEIGHT = 160;
const PLOT = { top: 8, bottom: 22, left: 52, right: 8 };

/**
 * `day` and `month` are the two axis ticks; `full` is the hover readout, which
 * always names the exact day because that is the whole point of hovering.
 *
 * The axis pair stays numeric and same-width on purpose — the ticks are
 * `tabular-nums`, and a `short` month name would set three labels of different
 * widths under a plot whose columns are evenly spaced.
 */
type DateStyle = 'day' | 'month' | 'full';

const dateOptions: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  day: { day: '2-digit', month: '2-digit' },
  month: { month: '2-digit', year: 'numeric' },
  full: { day: 'numeric', month: 'short', year: 'numeric' },
};

/**
 * Below this many days apart, a month tick repeats itself and the axis reads as
 * broken. Four months rather than a tidier three: it has to clear a 3M window
 * whose ends fall either side of a month boundary, which spans 92 days, without
 * sitting so close to that number that a leap year or a late business day flips
 * the format on one render and not the next.
 */
const MONTH_TICKS_FROM_DAYS = 120;

const MS_PER_DAY = 86_400_000;

/**
 * The year is dropped along with the month, not kept as a third field. A window
 * this short is read against the quote date printed above the chart, and
 * `29.07.2026` three times over is the crowding the day tick was added to fix.
 */
function tickStyleFor(points: readonly SeriesPoint[]): DateStyle {
  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined) return 'month';

  const span =
    (Date.parse(`${last.date}T12:00:00Z`) - Date.parse(`${first.date}T12:00:00Z`)) / MS_PER_DAY;
  // NaN from an unparseable date falls through to the month tick, which is the
  // format that was there before and is wrong in fewer cases.
  return span < MONTH_TICKS_FROM_DAYS ? 'day' : 'month';
}

function build(points: readonly SeriesPoint[], width: number, shape: 'line' | 'step') {
  if (points.length < 2 || width <= PLOT.left + PLOT.right) return null;

  const plot = {
    top: PLOT.top,
    left: PLOT.left,
    width: width - PLOT.left - PLOT.right,
    height: HEIGHT - PLOT.top - PLOT.bottom,
  };

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const mid = min + span / 2;

  const x = (index: number) => plot.left + (index / (points.length - 1)) * plot.width;
  // A flat series would divide by zero; draw it down the middle instead.
  const y = (value: number) =>
    span === 0 ? plot.top + plot.height / 2 : plot.top + (1 - (value - min) / span) * plot.height;

  // MAX is ~6000 business days against ~600px. Drawing every one costs a path
  // the browser re-rasterizes on each hover and, worse, aliases the extremes
  // away. One column keeps its own high and low, so the envelope survives
  // decimation — a peak is never smoothed off.
  const indices = decimate(points.length, Math.floor(plot.width), values);

  let path = '';
  for (const [position, index] of indices.entries()) {
    const point = points[index]!;
    if (position === 0) {
      path = `M ${x(index)} ${y(point.value)}`;
      continue;
    }
    if (shape === 'step') {
      // Horizontal to the next date at the old level, then vertical to the new
      // one: the change that actually happened, on the day it happened.
      path += ` L ${x(index)} ${y(points[indices[position - 1]!]!.value)}`;
    }
    path += ` L ${x(index)} ${y(point.value)}`;
  }

  return { path, x, y, min, max, mid, plot, drawn: indices.length };
}

/** Every index when they fit; otherwise each column's first, lowest, highest and last. */
function decimate(count: number, columns: number, values: readonly number[]): readonly number[] {
  if (columns < 2 || count <= columns) {
    return Array.from({ length: count }, (_, index) => index);
  }

  const perColumn = count / columns;
  const kept: number[] = [];

  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * perColumn);
    const end = Math.min(Math.floor((column + 1) * perColumn), count);
    if (start >= end) continue;

    let lowest = start;
    let highest = start;
    for (let index = start + 1; index < end; index += 1) {
      if (values[index]! < values[lowest]!) lowest = index;
      if (values[index]! > values[highest]!) highest = index;
    }

    for (const index of [start, Math.min(lowest, highest), Math.max(lowest, highest), end - 1]) {
      if (kept.at(-1) !== index) kept.push(index);
    }
  }

  return kept;
}
