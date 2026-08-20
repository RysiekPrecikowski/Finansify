import type Decimal from 'decimal.js';

import { type InstrumentId, type Instrument, type InstrumentKind } from '../ledger/types';
import { type Money, type Currency } from '../money';
import { type Temporal } from '../time';

export * from './vocabulary';
import { type ProviderName } from './vocabulary';

/**
 * How closely a historical series is sampled — a request parameter (chart
 * range picks a default, a caller can override it), not a stored property of
 * anything. `day` is exact; `week`/`month` bucket the underlying `day` rows so
 * a MAX-range chart stays in the hundreds of points rather than thousands.
 */
export type SeriesGrain = 'day' | 'week' | 'month';

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
 *
 * `currency` is `null` on a raw search hit — Yahoo's `search()` doesn't return
 * one, only `quote()` does, and calling `quote()` for every row of a
 * typeahead result would be a request per keystroke rather than one per
 * selection. `confirm()` is what fills it in.
 */
export interface InstrumentCandidate {
  readonly provider: ProviderName;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
  readonly currency: Currency | null;
  /**
   * Null when the candidate was rebuilt from a selection rather than produced
   * by `search()` — a client can name a symbol but cannot be trusted to say
   * what kind of thing it is, and `instruments` is global (ADR 0010), so an
   * unverified kind would be persisted once and then served to every user.
   * `confirm()` derives it from the live listing.
   */
  readonly kind: InstrumentKind | null;
  readonly isin: string | null;
}

/**
 * An `InstrumentCandidate` that has been through `confirm()`: the provider has
 * seen this exact listing and answered for it, so currency and kind are no
 * longer in question. Both are narrowed here only — `makeSelectInstrument`
 * still checks them at runtime, because an adapter can satisfy a narrowing by
 * assertion and these two fields decide what every later price is compared
 * against.
 */
export interface ConfirmedCandidate extends InstrumentCandidate {
  readonly currency: Currency;
  readonly kind: InstrumentKind;
}

/** One currency's mid rate to PLN on one day, from one provider — NBP table A. */
export interface FxRate {
  readonly currency: Currency;
  readonly date: Temporal.PlainDate;
  readonly mid: Decimal;
}

/**
 * A rate from a market feed: a pair, a value, and when it was quoted.
 *
 * Carries an `Instant` rather than a `PlainDate` because that is the whole
 * difference from `FxRate` — an NBP mid belongs to a publication day, a market
 * quote belongs to a moment, and flattening the second into the first is how a
 * 10:00 rate gets rendered as "today's rate" hours after it moved.
 */
export interface FxQuote {
  readonly base: Currency;
  readonly quote: Currency;
  readonly rate: Decimal;
  readonly at: Temporal.Instant;
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
