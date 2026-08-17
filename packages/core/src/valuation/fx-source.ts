import { type Currency } from '../money';

/**
 * Where an FX rate comes from.
 *
 * `nbp` is the official daily fixing — one mid per business day, published
 * around midday, and the rate Polish tax is computed at. `yahoo` is a market
 * quote that moves through the session.
 *
 * The two are both correct and answer different questions, which is why this is
 * a choice rather than a default someone has to live with. They differ by
 * roughly 7-22 bps on a quiet day (ADR 0017's measurements) and by more across
 * a weekend, so which one a figure came from is never cosmetic.
 */
export const fxSources = ['nbp', 'yahoo'] as const;

export type FxSource = (typeof fxSources)[number];

/**
 * How far the choice reaches.
 *
 * `charts` keeps the portfolio on NBP and lets the reader look at a market rate
 * on its own; `all` moves the valuation onto the chosen source too.
 *
 * `all` with `yahoo` is a real decision with a consequence worth stating: the
 * portfolio total is then computed from a series that the tax return will not
 * use, because Polish realized gains are converted at the NBP rate from the
 * business day before the transaction (`docs/domain.md`). The book and the
 * filing come apart by the spread. That is the reader's call to make — this
 * type exists so the code cannot make it silently.
 */
export const fxScopes = ['charts', 'all'] as const;

export type FxScope = (typeof fxScopes)[number];

export interface FxSourcePreference {
  readonly source: FxSource;
  readonly scope: FxScope;
}

/** NBP everywhere, which is the only combination where valuation and tax agree. */
export const defaultFxSourcePreference: FxSourcePreference = { source: 'nbp', scope: 'charts' };

/**
 * Which source a *valuation* should read, given the preference.
 *
 * The scope only ever narrows: `charts` leaves valuation on NBP whatever the
 * reader picked to look at. One function so no call site re-derives the rule
 * and gets it subtly different.
 */
export function valuationSource(preference: FxSourcePreference): FxSource {
  return preference.scope === 'all' ? preference.source : 'nbp';
}

/** Which source a *chart* should read. Always the one picked — that is what it is for. */
export function chartSource(preference: FxSourcePreference): FxSource {
  return preference.source;
}

/**
 * Whether valuation and tax will disagree under this preference, so the UI can
 * say so where it matters rather than burying it in a settings screen.
 */
export function valuationDivergesFromTax(preference: FxSourcePreference): boolean {
  return valuationSource(preference) !== 'nbp';
}

/**
 * A pair as one provider's symbol is not this package's business, but the pair
 * itself is: Yahoo quotes `EUR/USD` directly while NBP only ever publishes
 * against PLN, so a provider that speaks pairs needs a type that carries both
 * legs rather than a single currency.
 */
export interface FxQuotePair {
  readonly base: Currency;
  readonly quote: Currency;
}
