/**
 * One row of what `<InstrumentCombobox>` shows and, on selection, submits
 * back as hidden fields — never a free-text symbol or exchange the user
 * typed. `existing` is already in our database (id alone is enough);
 * `candidate` is a provider search hit, identified by its own `symbol` and
 * re-confirmed by `selectInstrument` before anything is persisted (ADR 0014).
 *
 * Shared between the server (`instrument-search.ts`, which builds these) and
 * the client (`instrument-combobox.tsx`, which only ever reads them). Nothing
 * here is executable — a type and a constant — so a client component can
 * import this file without pulling any server-only code into its bundle.
 */
export type InstrumentOption =
  | { readonly kind: 'existing'; readonly instrumentId: string; readonly label: string }
  | {
      readonly kind: 'candidate';
      readonly provider: string;
      readonly symbol: string;
      readonly name: string;
      // No kind, exchange or isin: the option exists to name a listing and to
      // label it. Anything descriptive would travel back as a form field the
      // client controls, and `instruments` is global — `confirm()` re-derives
      // all of it server-side instead. The exchange is already baked into
      // `label`.
      readonly label: string;
    }
  /**
   * A Polish retail treasury bond. No provider quotes these, so there is no
   * listing to confirm against and nothing to search — the series code is the
   * identity, and `selectBond` gates it by resolving the issue's terms
   * instead (ADR 0011). Offered whenever the query is *shaped* like a code;
   * whether the family exists is decided server-side, where a rejection can
   * explain itself.
   */
  | { readonly kind: 'bond'; readonly seriesCode: string; readonly label: string }
  /**
   * A Catalyst-listed corporate bond. Also bypasses `selectInstrument`, for a
   * different reason than a treasury bond: it *is* quoted, but `gpw`'s price
   * lookups are keyed by ISIN while the ticker is what search and the terms
   * resolver answer to — two identifiers `confirm()`'s one-`symbol` contract
   * cannot carry (ADR 0023, Stage 6). `makeSelectCatalystBond` looks the
   * ticker up again server-side and writes both.
   */
  | { readonly kind: 'catalyst_bond'; readonly ticker: string; readonly label: string };

/** Below this, a query is not worth a round trip — the same floor every source on the server checks. */
export const MIN_QUERY_LENGTH = 2;
