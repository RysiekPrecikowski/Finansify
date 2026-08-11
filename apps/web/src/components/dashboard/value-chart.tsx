import { type Direction } from '@/lib/format';

/**
 * The hero chart, as inline SVG on the server: no JavaScript, no layout shift,
 * and it renders in the first paint.
 *
 * `lightweight-charts` takes over in Phase 2 (docs/ui.md), when there are real
 * bars to pan and zoom through and a granularity toggle to honour. Until the
 * series comes from a price feed, a canvas library and a hydration boundary buy
 * nothing. Tap-to-inspect arrives with it — this version deliberately has no
 * hover-only affordances, because it has no affordances at all.
 */
export interface ValueChartProps {
  /** Plain numbers: pixel geometry, not money. The labels carry the money. */
  readonly points: readonly number[];
  readonly direction: Direction;
  readonly highLabel: string;
  readonly lowLabel: string;
  readonly label: string;
}

const viewWidth = 1000;
const viewHeight = 240;
const padding = 16;

function scale(points: readonly number[]): { xs: number[]; ys: number[] } {
  const high = Math.max(...points);
  const low = Math.min(...points);
  const span = high - low || 1;
  const usable = viewHeight - padding * 2;

  return {
    xs: points.map((_, index) => (index / Math.max(points.length - 1, 1)) * viewWidth),
    ys: points.map((value) => padding + (1 - (value - low) / span) * usable),
  };
}

export function ValueChart({ points, direction, highLabel, lowLabel, label }: ValueChartProps) {
  if (points.length < 2) return null;

  const { xs, ys } = scale(points);
  const line = xs.map((x, index) => `${index === 0 ? 'M' : 'L'}${x} ${ys[index]}`).join(' ');
  const area = `${line} L${viewWidth} ${viewHeight} L0 ${viewHeight} Z`;

  const stroke = direction === 'down' ? 'var(--loss)' : 'var(--gain)';
  const gradientId = `value-chart-${direction}`;

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-40 w-full sm:h-56"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
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
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Labels sit in HTML, not in the SVG: text inside a non-uniformly scaled
          viewBox stretches. */}
      <figcaption className="pointer-events-none absolute inset-0 flex flex-col justify-between py-1 text-right">
        <span className="text-muted-foreground bg-background/60 ml-auto rounded px-1 text-xs tabular-nums">
          {highLabel}
        </span>
        <span className="text-muted-foreground bg-background/60 ml-auto rounded px-1 text-xs tabular-nums">
          {lowLabel}
        </span>
      </figcaption>
    </figure>
  );
}
