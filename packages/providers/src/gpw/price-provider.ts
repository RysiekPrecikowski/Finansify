import {
  Money,
  Temporal,
  type PriceBar,
  type PriceProvider,
  type ResolvedSymbol,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { z } from 'zod';

import { fetchGpwChart } from './client';

const WARSAW = 'Europe/Warsaw';

/**
 * `chart-json.php` offers a handful of fixed windows, all ending "today" —
 * there is no arbitrary `from`/`to` (tried live and silently ignored: the
 * response echoes back `{mode, isin}` with no `data` key at all) — plus one
 * unbounded mode, `ARCH`, that returns the instrument's entire history back
 * to its first session in a single response (confirmed live: PKN Orlen comes
 * back to 1999, 6,690 bars, ~440 KB). A routine 15-minute refresh only ever
 * needs the last few days, so it asks for the smallest window that covers
 * `from`; only a `from` older than the widest fixed window (`1R`, one year —
 * i.e. an actual backfill) pays the `ARCH` request's much larger payload.
 */
const WINDOWS = [
  { mode: '14D', days: 14 },
  { mode: '1M', days: 31 },
  { mode: '3M', days: 92 },
  { mode: '6M', days: 183 },
  { mode: '1R', days: 366 },
] as const;

function windowCovering(from: Temporal.PlainDate, today: Temporal.PlainDate): string {
  const daysNeeded = from.until(today).days;
  return (WINDOWS.find((w) => daysNeeded <= w.days) ?? { mode: 'ARCH' }).mode;
}

const barSchema = z.object({
  t: z.number(),
  // `o`/`h`/`l`/`v` ride along in the response but nothing here reads them —
  // only `c` (close) becomes a `PriceBar`.
  c: z.number(),
});

const chartEntrySchema = z.object({
  mode: z.string(),
  isin: z.string(),
  // Absent entirely for an unrecognised isin/mode pair — not an empty array —
  // so this stays optional rather than defaulting it away.
  data: z.array(barSchema).optional(),
});

export const gpwPriceProvider: PriceProvider = {
  name: 'gpw',

  /**
   * Equities, ETFs, and `catalyst_bond` — the retail-treasury `bond` kind is
   * never quoted here (it accrues, ADR 0011). `fund` (TFI/PPK units) is not
   * exchange-traded — that is `bankier`'s history to serve.
   *
   * A Catalyst bar arrives exactly like an equity bar: money, in the bond's
   * own currency. It just means "per 100 nominal" rather than "per share" —
   * a bond price convention, not a new `PriceBar` shape. `valueCatalystBondQuote`
   * (ADR 0023) does the one multiplication that turns it into a market value
   * per bond; nothing here needed to change to serve it.
   */
  capabilitiesFor(kind) {
    return kind === 'equity' || kind === 'etf' || kind === 'catalyst_bond'
      ? { history: true, spot: false }
      : { history: false, spot: false };
  },

  /**
   * `ref.symbol` is the instrument's ISIN — `chart-json.php` is keyed by
   * ISIN, not a ticker, so there is no separate GPW symbol to map.
   */
  async fetchDailyBars(
    ref: ResolvedSymbol,
    from: Temporal.PlainDate,
  ): Promise<readonly PriceBar[]> {
    const today = Temporal.Now.plainDateISO(WARSAW);
    const mode = windowCovering(from, today);

    const raw = await fetchGpwChart(ref.symbol, mode);
    const [entry] = z.array(chartEntrySchema).min(1).parse(raw);

    const bars: PriceBar[] = [];
    for (const bar of entry!.data ?? []) {
      if (!Number.isFinite(bar.c) || bar.c <= 0) continue;

      const date = Temporal.Instant.fromEpochMilliseconds(bar.t * 1000)
        .toZonedDateTimeISO(WARSAW)
        .toPlainDate();

      bars.push({
        instrumentId: ref.instrumentId,
        date,
        close: Money.of(new Decimal(bar.c), ref.currency),
      });
    }

    return bars;
  },
};
