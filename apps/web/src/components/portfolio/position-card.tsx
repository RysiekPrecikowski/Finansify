import { Money, type PriceLookup, type ValuedPosition } from '@finansify/core';
import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  directionOf,
  directionSurface,
  formatMoney,
  formatPlainDate,
  formatQuantity,
  formatRatioAsPercent,
} from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

import { Monogram } from './shared';

/**
 * One open position, as the phone card the approved canvas artboard specifies:
 * identity and market value on top, a three-up cost row under it, and a
 * hairline footer carrying the accounts it is held in and the way into its
 * lots. Rendered through `<DataList mobileCard>`, so the desktop `<table>`
 * still comes from the same column definitions.
 *
 * **Retail bonds are a different row, not a styled variant of this one.**
 * Nothing quotes them (ADR 0011, `docs/domain.md` "Bond accrual") — they are
 * subscribed from and redeemed by the Ministry, and their value comes from the
 * accrual engine running against published interest tables. So a bond never
 * shows a price, a stale-quote timestamp, or a "not mapped to a provider"
 * notice: all three describe a market feed that will never exist for it, and
 * the last one reads as a defect rather than as the normal state of the
 * instrument. It carries `accrualNote` in that slot instead.
 *
 * `catalyst_bond` is deliberately *not* included in that branch: a
 * Catalyst-listed bond is continuously traded on GPW and priced exactly like an
 * equity (ADR 0023), so it takes the ordinary path.
 */

function isAccrued(position: ValuedPosition): boolean {
  return position.instrument.kind === 'bond';
}

function Stat({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground truncate text-[0.6875rem]">{label}</span>
      <span className="truncate text-sm tabular-nums">{children}</span>
    </div>
  );
}

export function PositionCard({
  position,
  lookup,
  href,
  locale,
  dictionary,
}: Readonly<{
  position: ValuedPosition;
  /** From `valuationLookups` — the map that includes accrued bonds, not the quote-only one. */
  lookup: PriceLookup | undefined;
  href: Route;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.portfolio;
  const accrued = isAccrued(position);

  const [value] = position.marketValueByCurrency;
  const [unrealized] = position.unrealizedByCurrency;
  const [costBasis] = position.costBasisByCurrency;
  const direction = unrealized === undefined ? 'flat' : directionOf(unrealized);

  // Percent rather than the absolute figure, as the artboard has it — the
  // amount is already implied by value minus cost, and a pill has room for one.
  // Kept as a decimal string all the way to `Intl`, never a `number` (ADR 0005).
  const ratio =
    unrealized !== undefined && costBasis !== undefined && !costBasis.isZero()
      ? unrealized.amount.dividedBy(costBasis.amount).toFixed(6)
      : null;

  const unpriced = position.marketValueByCurrency.length === 0;
  const unpricedReason =
    lookup?.status === 'unavailable' && lookup.reason === 'unmapped'
      ? strings.unavailableUnmapped
      : strings.unavailableNeverFetched;

  return (
    <div className="bg-card flex flex-col gap-3 rounded-2xl px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Monogram symbol={position.instrument.symbol} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{position.instrument.symbol}</p>
          <p className="text-muted-foreground truncate text-xs">{position.instrument.name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {unpriced ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : (
            <span className="text-sm font-semibold tabular-nums">
              {formatMoney(value!, locale)}
            </span>
          )}

          {unpriced ? (
            <span className="text-muted-foreground/70 text-[0.6875rem]">{unpricedReason}</span>
          ) : ratio !== null ? (
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums',
                directionSurface[direction],
              )}
            >
              {formatRatioAsPercent(ratio, locale, { signed: true })}
            </span>
          ) : null}
        </div>
      </div>

      {/* The one genuinely type-aware line. A bond states where its value came
          from; everything else states how old its quote is, and only when
          that is worth saying. */}
      {accrued ? (
        <p className="text-muted-foreground/70 -mt-1 text-[0.6875rem]">{strings.accrualNote}</p>
      ) : (
        lookup?.status === 'stale' && (
          <p className="text-muted-foreground/70 -mt-1 text-[0.6875rem]">
            {dictionary.dashboard.asOf} {formatPlainDate(lookup.asOf, locale)} ·{' '}
            {dictionary.dashboard.stale}
          </p>
        )
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label={strings.quantity}>{formatQuantity(position.quantity.toFixed(), locale)}</Stat>
        <Stat label={strings.averageCost}>
          {position.averageCost === null || costBasis === undefined ? (
            <Badge variant="outline" className="font-normal">
              {strings.multipleCurrencies}
            </Badge>
          ) : (
            formatMoney(Money.of(position.averageCost, costBasis.currency), locale)
          )}
        </Stat>
        <Stat label={strings.costBasis}>
          {costBasis === undefined ? '—' : formatMoney(costBasis, locale)}
        </Stat>
      </div>

      <div className="border-border flex items-center justify-between gap-2 border-t pt-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-muted-foreground text-[0.6875rem]">{strings.accounts}</span>
          <span className="truncate text-xs">
            {[
              ...new Set(
                position.lines.map(
                  (line) => `${dictionary.wrappers[line.account.wrapper]} · ${line.account.broker}`,
                ),
              ),
            ].join(', ')}
          </span>
        </div>
        <Link
          href={href}
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-0.5 text-xs transition-colors"
        >
          {strings.lots.title}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
