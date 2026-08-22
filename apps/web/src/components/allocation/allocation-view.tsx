'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';

import { SelectChips, type SelectChip } from '@/components/filter-chips';
import {
  buildOrders,
  buildRebalance,
  buildRing,
  concentrationShare,
  demoAmounts,
  demoConcentration,
  demoDimensions,
  demoInstrumentTargets,
  dimensions,
  models,
  type Dimension,
  type ModelId,
} from '@/lib/allocation/demo-allocation';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { intlLocale, type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * "Skład i rebalans", in full.
 *
 * A client component because three of its six sections are genuinely
 * interactive and every figure they produce is derived in the browser from
 * constants already on the client — switching a dimension, a model or a
 * contribution size has nothing to fetch, so a server round trip per press
 * would be latency for its own sake. That is the one respect in which this
 * screen differs from the dashboard's and `/portfolio`'s URL-driven filters.
 *
 * **No green or red anywhere on this screen.** Deviations are directional, not
 * profit and loss, and `apps/web/AGENTS.md` reserves those two colours for
 * realized/unrealized P&L alone. Direction is carried by which side of centre a
 * bidirectional bar fills and by `--brand` versus the plain foreground — the
 * same second accent the benchmark line and the IKE/IKZE warning already use.
 * (An earlier written spec suggested red/green here; it predates that rule.)
 *
 * Every number comes from `lib/allocation/demo-allocation.ts` and is synthetic
 * — see that module for what is portfolio-shaped and what is outright invented.
 */

/**
 * Neutral ramp — the same `--chart-*` tokens as the dashboard's sector
 * breakdown, but ordered **lightest first**, which is the order the approved
 * artboard uses and the opposite of `sector-breakdown.tsx`.
 *
 * Not a style preference: `--chart-5` is the darkest step in both themes, so
 * putting it first paints the *largest* slice at 0.28 lightness against a 0.2
 * card in dark mode — the biggest number on the ring, and the one hardest to
 * see. Largest-lightest keeps the dominant slice legible on the dark theme,
 * which is the one the artboards are drawn in.
 */
const ramp = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function Section({
  title,
  subtitle,
  children,
}: Readonly<{ title: string; subtitle?: string; children: React.ReactNode }>) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {subtitle !== undefined && (
          <span className="text-muted-foreground/70 text-[0.6875rem]">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A muted footnote with an info glyph — the same shape `/portfolio`'s total note uses. */
function Note({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function AllocationView({
  locale,
  dictionary,
}: Readonly<{ locale: Locale; dictionary: Dictionary }>) {
  const [dimension, setDimension] = useState<Dimension>('class');
  const [model, setModel] = useState<ModelId>('own');
  const [contributionsOnly, setContributionsOnly] = useState(false);
  const [amount, setAmount] = useState<number>(demoAmounts[1]);

  const strings = dictionary.allocation;
  const tag = intlLocale[locale];

  const percent = (value: number, digits = 1) =>
    new Intl.NumberFormat(tag, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value) + '%';

  const points = (value: number) =>
    `${new Intl.NumberFormat(tag, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    }).format(value)} pp`;

  const money = (value: number) =>
    new Intl.NumberFormat(tag, {
      style: 'currency',
      currency: 'PLN',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      // `pl-PL` otherwise starts grouping only at five digits, which puts
      // `4082,40 zł` in a column beside `12 480,00 zł` (docs/ui.md).
      useGrouping: 'always',
    }).format(value);

  const thousands = (value: number) =>
    `${new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
      value / 1000,
    )} tys. zł`;

  const slices = demoDimensions[dimension];
  const ring = buildRing(slices);
  const rows = buildRebalance(model);
  const orders = buildOrders(rows, contributionsOnly, amount);

  const dimensionOptions: readonly SelectChip<Dimension>[] = dimensions.map((id) => ({
    value: id,
    label: strings.dimensions[id],
  }));
  const modelOptions: readonly SelectChip<ModelId>[] = models.map((id) => ({
    value: id,
    label: strings.models[id],
  }));
  const amountOptions: readonly SelectChip<string>[] = demoAmounts.map((value) => ({
    value: String(value),
    label: `${value / 1000} tys.`,
  }));

  const labelOf = (key: string) =>
    (strings.labels as Record<string, string | undefined>)[key] ?? key;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      {/* 1 — Skład */}
      <Section title={strings.composition.title} subtitle={strings.composition.subtitle}>
        <SelectChips
          label={strings.pickDimension}
          options={dimensionOptions}
          selected={dimension}
          onSelect={setDimension}
        />

        <div className="bg-card flex flex-col gap-4 rounded-2xl p-4">
          <div className="flex justify-center">
            <svg
              viewBox="0 0 120 120"
              className="size-40"
              role="img"
              aria-label={strings.composition.title}
            >
              {ring.map((segment, index) => (
                <path
                  key={slices[index]!.labelKey}
                  d={segment.path}
                  fill={ramp[segment.rampIndex % ramp.length]}
                />
              ))}
            </svg>
          </div>

          <ul className="flex flex-col gap-2.5">
            {slices.map((slice, index) => (
              <li key={slice.labelKey} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="ring-border size-2.5 shrink-0 rounded-[3px] ring-1"
                  style={{ backgroundColor: ramp[index % ramp.length] }}
                />
                <span className="flex-1 truncate">{labelOf(slice.labelKey)}</span>
                <span className="text-muted-foreground/70 shrink-0 text-xs tabular-nums">
                  {slice.value}
                </span>
                <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {percent(slice.share)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* 2 — Koncentracja */}
      <Section title={strings.concentration.title} subtitle={strings.concentration.subtitle}>
        <div className="bg-card flex flex-col gap-2.5 rounded-2xl p-4">
          {demoConcentration.map((entry, index) => (
            <div key={entry.symbol} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 truncate font-medium">{entry.symbol}</span>
              <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(entry.share / demoConcentration[0]!.share) * 100}%`,
                    backgroundColor: ramp[index % ramp.length],
                  }}
                />
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums">{percent(entry.share)}</span>
            </div>
          ))}
        </div>
        <Note>
          {interpolate(strings.concentration.note, { share: percent(concentrationShare()) })}
        </Note>
      </Section>

      {/* 3 — Rebalans */}
      <Section title={strings.rebalance.title} subtitle={strings.rebalance.subtitle}>
        <SelectChips
          label={strings.rebalance.pickModel}
          options={modelOptions}
          selected={model}
          onSelect={setModel}
        />

        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.key} className="bg-card flex flex-col gap-2.5 rounded-2xl p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{labelOf(row.key)}</span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {percent(row.now)}
                  <span className="mx-1.5">→</span>
                  <span className="text-foreground">{percent(row.target)}</span>
                </span>
              </div>

              {/* Bidirectional: the fill grows out from centre, left when the
                  class is under target and right when it is over. Direction is
                  position and accent, never colour. */}
              <div className="bg-muted relative h-1.5 w-full rounded-full">
                <span
                  aria-hidden
                  className="bg-border absolute top-1/2 left-1/2 h-2.5 w-px -translate-y-1/2"
                />
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: row.deviation > 0 ? '50%' : `${50 - row.barWidth}%`,
                    right: row.deviation > 0 ? `${50 - row.barWidth}%` : '50%',
                    backgroundColor: row.withinTolerance
                      ? 'var(--muted-foreground)'
                      : row.deviation > 0
                        ? 'var(--brand)'
                        : 'var(--foreground)',
                  }}
                />
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground text-[0.6875rem] tabular-nums">
                  {strings.rebalance.deviation} {points(row.deviation)}
                </span>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    row.withinTolerance
                      ? 'text-muted-foreground/70'
                      : 'text-foreground font-semibold',
                  )}
                >
                  {row.withinTolerance
                    ? strings.rebalance.withinTolerance
                    : `${row.deviation > 0 ? strings.rebalance.sell : strings.rebalance.buy} ${thousands(row.amount)}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 4 — Tylko nowymi wpłatami */}
      <Section title={strings.contributions.title}>
        <div className="bg-card flex flex-col gap-3.5 rounded-2xl p-4">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={contributionsOnly}
              onChange={(event) => setContributionsOnly(event.target.checked)}
              className="accent-foreground size-4 shrink-0"
            />
            <span className="text-sm font-medium">{strings.contributions.toggle}</span>
          </label>

          <SelectChips
            label={strings.contributions.pickAmount}
            options={amountOptions}
            selected={String(amount)}
            onSelect={(value) => setAmount(Number(value))}
            disabled={!contributionsOnly}
          />

          <p className="text-muted-foreground text-xs">
            {contributionsOnly
              ? interpolate(strings.contributions.on, { amount: thousands(amount) })
              : strings.contributions.off}
          </p>
        </div>
      </Section>

      {/* 5 — Zlecenia */}
      <Section title={strings.orders.title} subtitle={String(orders.length)}>
        {orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">{strings.orders.empty}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {orders.map((order) => (
              <div
                key={`${order.key}:${order.sell ? 'sell' : 'buy'}`}
                className="bg-card flex items-center gap-3 rounded-2xl px-4 py-3"
              >
                {/* Buy is filled, sell is outlined in `--brand`. Not green and
                    red: a planned order is not a realized result. */}
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold tracking-wider uppercase',
                    order.sell
                      ? 'text-brand ring-brand ring-1 ring-inset'
                      : 'bg-foreground text-background',
                  )}
                >
                  {order.sell ? strings.rebalance.sell : strings.rebalance.buy}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{order.symbol}</span>
                  <span className="text-muted-foreground truncate text-[0.6875rem]">
                    {order.name} ·{' '}
                    {interpolate(strings.orders.units, { count: String(order.quantity) })}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {money(order.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
        <Note>{strings.orders.note}</Note>
      </Section>

      {/* 6 — Cele na instrument */}
      <Section
        title={strings.instrumentTargets.title}
        subtitle={strings.instrumentTargets.subtitle}
      >
        <div className="bg-card overflow-hidden rounded-2xl">
          <div className="text-muted-foreground/70 grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2.5 text-[0.625rem] font-medium tracking-wider uppercase">
            <span>{strings.instrumentTargets.symbol}</span>
            <span className="w-12 text-right">{strings.instrumentTargets.now}</span>
            <span className="w-12 text-right">{strings.instrumentTargets.target}</span>
            <span className="w-14 text-right">{strings.instrumentTargets.deviation}</span>
          </div>
          {demoInstrumentTargets.map((entry) => {
            const deviation = entry.now - entry.target;
            return (
              <div
                key={entry.symbol}
                className="border-border grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-t px-4 py-3 text-sm"
              >
                <span className="truncate font-semibold">{entry.symbol}</span>
                <span className="w-12 text-right tabular-nums">{percent(entry.now)}</span>
                <span className="text-muted-foreground w-12 text-right tabular-nums">
                  {percent(entry.target)}
                </span>
                {/* Brand indigo above target, plain foreground below — the same
                    neutral/accent pairing the deviation bars use. */}
                <span
                  className={cn(
                    'w-14 text-right text-xs font-semibold tabular-nums',
                    deviation > 0 ? 'text-brand' : 'text-foreground',
                  )}
                >
                  {points(deviation)}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
