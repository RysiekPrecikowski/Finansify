import type Decimal from 'decimal.js';

import { type InstrumentId, type Instrument, type InstrumentKind } from '../ledger/types';
import { type Money, type Currency } from '../money';
import { type Temporal } from '../time';

export * from './vocabulary';
import { type ProviderName } from './vocabulary';

/** One trading day's closing price for one instrument, from one provider. */
export interface PriceBar {
  readonly instrumentId: InstrumentId;
  readonly date: Temporal.PlainDate;
  readonly close: Money;
}

/** A `PriceBar` as it comes back out of storage, with provenance. */
export interface StoredBar extends PriceBar {
  readonly source: ProviderName;
  readonly fetchedAt: Temporal.Instant;
}

/**
 * What the render path actually needs: not just a price, but whether it can be
 * trusted as current. `stale` still carries a usable `close` — a position with
 * a stale bar is valued, not blanked, with its date shown alongside. Only
 * `unavailable` withholds a number, and only then does a position become
 * unvaluable.
 *
 * `reason` distinguishes two `unavailable` causes for the UI: `never-fetched`
 * means the instrument is mapped but no bar has landed yet (a refresh is
 * likely in flight); `unmapped` means nobody has resolved it to a provider
 * symbol, so nothing will fetch until PR 6's mapping screen does.
 */
export type PriceLookup =
  | {
      readonly status: 'fresh';
      readonly close: Money;
      readonly asOf: Temporal.PlainDate;
      readonly fetchedAt: Temporal.Instant;
    }
  | {
      readonly status: 'stale';
      readonly close: Money;
      readonly asOf: Temporal.PlainDate;
      readonly fetchedAt: Temporal.Instant;
    }
  | { readonly status: 'unavailable'; readonly reason: 'never-fetched' | 'unmapped' };

/** One instrument, tied to exactly the provider symbol it trades under. */
export interface ResolvedSymbol {
  readonly instrumentId: InstrumentId;
  readonly provider: ProviderName;
  readonly symbol: string;
  /** Expected currency — the adapter compares its response against this and refuses on mismatch. */
  readonly currency: Currency;
}

/**
 * One provider's listing, offered to the user as something to select — from a
 * typeahead search, never typed in by hand. Nothing here is persisted until
 * it's confirmed (`InstrumentSearchProvider.confirm`) and turned into an
 * `Instrument`: search results reflect the provider's index, which can be
 * stale by the time the user picks one.
 */
export interface InstrumentCandidate {
  readonly provider: ProviderName;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
  readonly currency: Currency;
  readonly kind: InstrumentKind;
  readonly isin: string | null;
}

/** One currency's mid rate to PLN on one day, from one provider — NBP table A. */
export interface FxRate {
  readonly currency: Currency;
  readonly date: Temporal.PlainDate;
  readonly mid: Decimal;
}

export interface StoredFxRate extends FxRate {
  readonly source: ProviderName;
  readonly fetchedAt: Temporal.Instant;
}

export type FxRateLookup =
  | {
      readonly status: 'fresh';
      readonly mid: Decimal;
      readonly asOf: Temporal.PlainDate;
      readonly fetchedAt: Temporal.Instant;
    }
  | {
      readonly status: 'stale';
      readonly mid: Decimal;
      readonly asOf: Temporal.PlainDate;
      readonly fetchedAt: Temporal.Instant;
    }
  | { readonly status: 'unavailable' };

/** Outcome of one `refreshPrices` / `refreshFxRates` round, for the caller to log or surface. */
export interface RefreshReport<T> {
  readonly refreshed: readonly T[];
  /** Only meaningful for prices: instruments with no `ResolvedSymbol` on file. */
  readonly unmapped: readonly T[];
  readonly failed: readonly T[];
}

/** Re-exported so callers of `resolveSymbol` don't also need to import `ledger`. */
export type { Instrument };
