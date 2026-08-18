import { Temporal, type IndexObservation } from '@finansify/core';

import { type Locale } from '@/lib/i18n/locales';

import { SeriesChart } from './series-chart';

/**
 * How far back the macro chart goes.
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

/**
 * The macro series as a step chart with axes, over the last ten years.
 *
 * A step rather than a line because both series *are* steps: a reference rate
 * holds flat until the RPP moves it and a CPI print stands for its whole month,
 * so interpolating between points would draw a change that never happened.
 *
 * Deliberately not in the profit-and-loss colours (`docs/ui.md`) — it uses the
 * neutral chart token. A falling reference rate is neither good nor bad on its
 * own: good for a borrower, bad for a saver.
 */
export function IndicatorChart({
  history,
  locale,
  label,
}: Readonly<{ history: readonly IndexObservation[]; locale: Locale; label: string }>) {
  const newest = history.at(-1);
  if (newest === undefined) return null;

  const from = newest.effectiveFrom.subtract({ years: WINDOW_YEARS });
  const recent = history.filter(
    (observation) => Temporal.PlainDate.compare(observation.effectiveFrom, from) >= 0,
  );

  return (
    <SeriesChart
      points={recent.map((observation) => ({
        date: observation.effectiveFrom.toString(),
        value: Number(observation.value.toFixed(6)),
      }))}
      shape="step"
      format="percent"
      locale={locale}
      label={label}
    />
  );
}
