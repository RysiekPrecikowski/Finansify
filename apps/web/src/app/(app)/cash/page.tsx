import { currency as toCurrency, makeListPositions } from '@finansify/core';
import { Info } from 'lucide-react';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { getCurrentUser } from '@/lib/auth';
import {
  buildCashSummary,
  buildCurrencyExposure,
  cashShareOfPortfolio,
  rampIndex,
} from '@/lib/cash/summary';
import { type DisplaySettings } from '@/lib/display/currencies';
import { getDisplaySettings, getFxPreference } from '@/lib/display/server';
import { formatMoney, formatRatioAsPercent } from '@/lib/format';
import { plural, type Dictionary } from '@/lib/i18n/dictionaries';
import { getDictionary, getLocale } from '@/lib/i18n/server';
import { type Locale } from '@/lib/i18n/locales';
import { loadPositions } from '@/lib/positions';
import { getInstruments, scopedLedgerFor } from '@/server/container';
import { valuePositionsFor } from '@/server/portfolio-valuation';
import { type FxSourcePreference, type PositionsView } from '@finansify/core';

/** Neutral ramp, lightest first — the same tokens and direction `/allocation` settled on. */
const ramp = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function Metric({
  label,
  children,
  large = false,
}: Readonly<{ label: string; children: ReactNode; large?: boolean }>) {
  return (
    <div className="bg-card flex min-w-0 flex-col gap-1.5 rounded-2xl px-3.5 py-3">
      <span className="text-muted-foreground truncate text-[0.6rem] font-semibold tracking-[0.07em] uppercase">
        {label}
      </span>
      <span
        className={
          large
            ? 'truncate text-2xl font-semibold tracking-tight tabular-nums'
            : 'truncate text-[0.9375rem] font-semibold tracking-tight tabular-nums'
        }
      >
        {children}
      </span>
    </div>
  );
}

function Note({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function SectionHead({ title, meta }: Readonly<{ title: string; meta?: string }>) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {meta !== undefined && (
        <span className="text-muted-foreground/70 text-[0.6875rem]">{meta}</span>
      )}
    </div>
  );
}

function CashFallback() {
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-muted/30 h-20 animate-pulse rounded-2xl" />
      <div className="bg-muted/30 h-40 animate-pulse rounded-2xl" />
    </div>
  );
}

/**
 * Everything that needs a price or an FX rate. On its own `<Suspense>`
 * boundary for the same reason `/portfolio`'s open positions are: the ledger
 * read is instant and only this part waits on a provider.
 */
async function CashSections({
  view,
  display,
  fxPreference,
  locale,
  dictionary,
}: Readonly<{
  view: PositionsView;
  display: DisplaySettings;
  fxPreference: FxSourcePreference;
  locale: Locale;
  dictionary: Dictionary;
}>) {
  const strings = dictionary.cash;
  const presentation = toCurrency(display.total);

  // `lines: 'native'` is what makes currency exposure answerable at all — the
  // per-position values come back in the currency each instrument is actually
  // denominated in, rather than pre-converted into one (see
  // `buildCurrencyExposure`). The total is still the reader's own currency.
  const { valuation, ratesToPln } = await valuePositionsFor(
    view.open,
    view.cash,
    display,
    fxPreference,
    { total: presentation, lines: 'native' },
  );

  const cash = buildCashSummary(view.cash, ratesToPln, presentation);
  // The *valued* positions, not the ledger ones — `marketValueByCurrency` is
  // what carries the native-currency figures exposure is grouped by.
  const exposure = buildCurrencyExposure(valuation.positions, view.cash, ratesToPln, presentation);

  // Share of the *whole* portfolio, from the valuation's own total plus the
  // cash this page just summed — never a figure lifted off another screen.
  const portfolioTotal = valuation.totalMarketValue.plus(cash.total);
  const share = cashShareOfPortfolio(cash.total, portfolioTotal);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Metric label={strings.totalLabel} large>
          {formatMoney(cash.total, locale)}
        </Metric>
        <div className="grid grid-cols-2 gap-2">
          <Metric label={strings.shareLabel}>
            {share === null ? strings.balances.noRate : formatRatioAsPercent(share, locale)}
          </Metric>
          <Metric label={strings.currenciesLabel}>{cash.currencyCount}</Metric>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <SectionHead
          title={strings.balances.title}
          meta={plural(dictionary.dashboard.accounts.count, cash.rows.length, locale)}
        />

        {cash.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{strings.balances.empty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {cash.rows.map((row) => (
              <div
                key={`${row.accountId}::${row.amount.currency}`}
                className="bg-card flex flex-col gap-2.5 rounded-2xl px-3.5 py-3"
              >
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="truncate text-sm font-semibold">{row.accountName}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatMoney(row.amount, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-muted-foreground tracking-wider uppercase"
                    >
                      {dictionary.wrappersShort[row.wrapper]}
                    </Badge>
                    <span className="text-muted-foreground text-[0.6875rem] whitespace-nowrap">
                      {row.amount.currency} · {strings.balances.rate}{' '}
                      {/* An em-dash, not `1,0000`: a balance already in the
                          presentation currency was never converted, and a rate
                          of one would imply it was. */}
                      {row.rate === null
                        ? strings.balances.noRate
                        : formatMoney(row.rate, locale, { bare: true, fractionDigits: 4 })}
                    </span>
                  </div>
                  {row.converted !== null && (
                    <span className="text-muted-foreground shrink-0 text-[0.6875rem] tabular-nums">
                      = {formatMoney(row.converted, locale)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Note>{strings.balances.note}</Note>
        {!cash.totalIsComplete && (
          <p className="text-muted-foreground text-xs">{strings.balances.incomplete}</p>
        )}
      </section>

      {exposure.slices.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHead title={strings.exposure.title} meta={strings.exposure.subtitle} />

          {/* `rounded-xl`, not `rounded-full`. At 3% of the width a pill radius
              is wider than the segment itself, so the smallest currency is
              swallowed by the rounding of its neighbour and disappears. */}
          <div className="bg-muted flex h-8 w-full overflow-hidden rounded-xl">
            {exposure.slices.map((slice, index) => (
              <div
                key={slice.currency}
                style={{
                  width: `${Number(slice.share) * 100}%`,
                  backgroundColor: ramp[rampIndex(index, exposure.slices.length, ramp.length)],
                }}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {exposure.slices.map((slice, index) => (
              <div
                key={slice.currency}
                className="bg-card flex min-w-0 flex-col gap-2 rounded-2xl px-3.5 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="ring-border size-2.5 shrink-0 rounded-[3px] ring-1"
                    style={{
                      backgroundColor: ramp[rampIndex(index, exposure.slices.length, ramp.length)],
                    }}
                  />
                  <span className="truncate text-sm font-semibold">{slice.currency}</span>
                </div>
                <span className="truncate text-lg font-semibold tracking-tight tabular-nums">
                  {formatRatioAsPercent(slice.share, locale)}
                </span>
                <span className="text-muted-foreground truncate text-[0.6875rem] tabular-nums">
                  {formatMoney(slice.value, locale)}
                </span>
              </div>
            ))}
          </div>

          <Note>{strings.exposure.note}</Note>
        </section>
      )}
    </>
  );
}

/**
 * "Gotówka i waluty" — cash per account and currency, and what share of the
 * whole portfolio each currency represents.
 *
 * Built on the read model `/portfolio` already uses (`buildCashBalances` via
 * `makeListPositions`) rather than a second cash source, and on the FX rates
 * the valuation pipeline already fetches. Reached from the nav drawer only;
 * the bottom bar and the desktop rail stay at four items.
 */
export default async function CashPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const ledger = scopedLedgerFor(user.id);
  const listPositions = makeListPositions({ ledger, instruments: getInstruments() });

  const [positions, dictionary, locale, display, fxPreference] = await Promise.all([
    loadPositions(listPositions),
    getDictionary(),
    getLocale(),
    getDisplaySettings(),
    getFxPreference(),
  ]);

  if (!positions.ok) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <p className="text-muted-foreground px-1 py-8 text-sm">
          {dictionary.portfolio.mixedCurrencyError}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Suspense fallback={<CashFallback />}>
        <CashSections
          view={positions.view}
          display={display}
          fxPreference={fxPreference}
          locale={locale}
          dictionary={dictionary}
        />
      </Suspense>
    </div>
  );
}
