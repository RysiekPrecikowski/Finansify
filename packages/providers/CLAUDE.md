# packages/providers

The external-data adapters: Yahoo Finance, GPW's own `chart-json.php`, and
bankier.pl's public chart API for prices, Yahoo for instrument resolution, NBP
for FX. See `docs/data-sources.md` for what each source offers, ADR 0014 for
why lazy ingestion was chosen, and ADR 0022 for the provider chain and
per-kind capabilities that let more than one price source coexist.

## Rules

- Imports `@finansify/core` only, to implement its `valuation` ports; never
  imports `@finansify/db` or `apps/web` (adapters don't import each other —
  `docs/architecture.md`).
- One module per provider (`src/yahoo/`, `src/gpw/`, `src/bankier/`,
  `src/nbp/`). Nothing in `src/yahoo/` may be imported from `src/gpw/` or
  `src/nbp/`, or vice versa.
- `numeric` values become `Decimal`/`Money` at the edge of this package —
  never `Number()`, never `parseFloat` (rule 1). Yahoo's bar closes arrive as
  float32 artifacts (`155.67999267578125`); round through
  `Decimal(...).toDecimalPlaces(meta.priceHint)` before they leave this
  package. LSE pence-quoted instruments report `meta.currency === 'GBp'`;
  divide by 100 after rounding, storing the instrument's `GBP` value, not
  pence.
- `yahoo/search-instruments.ts` holds the hard gate that `resolve-symbol.ts`
  used to (that file is gone; selection is search-first now). `search()`
  surfaces real Yahoo listings rather than a ticker assembled from a MIC code,
  and `confirm()` answers **only** from its own `quote()` call:
  - the quote must be for the symbol that was picked — Yahoo normalizes and
    repoints symbols silently, and accepting one would marry the picked symbol
    to another listing's currency;
  - `kind` is re-derived from `quote.quoteType`, never carried over. A
    candidate reaching `confirm()` may have been rebuilt from form fields, so
    `search()`'s own `quoteType` filter gates only what a user can _see_;
  - a missing `currency` or `exchange` refuses the selection.

  Nothing descriptive is taken from the candidate, because `instruments` is
  global (ADR 0010): a field the client asserts is written once and then served
  to every other user. ISIN never gates a mapping and is not stored from this
  path at all — Yahoo's `search()` returns exactly one listing per ISIN even
  when several exist, so trusting it silently prices the wrong listing.

- Requests are serialized (~1/s) and retry on `429` with backoff
  (1s/4s/16s, 3 attempts) inside the adapter. The cross-instrument circuit
  breaker (stop the whole refresh round after two consecutive failures) lives
  in `core`'s `makeRefreshPrices`, not here — this package only handles a
  single request's own retries.
- `gpw/client.ts`'s WAF resets the TCP connection outright — no `429`, no
  body — for a request that doesn't look like a browser tab navigating from
  the instrument's own page; `Referer` and the `Sec-Fetch-*` triad are
  required, not decorative. There is no status code to read on that failure,
  so every failure (network-level or non-OK) gets the same backoff, unlike
  Yahoo's `is429`. `chart-json.php` is keyed by **ISIN**, not a ticker — a
  `gpw` row's `instrument_identifiers.symbol` is the instrument's ISIN
  verbatim. `mode: 'ARCH'` returns an instrument's entire history in one
  request (confirmed live back to 1999 for a real listing); the adapter uses
  it only when `from` is older than the widest fixed window, so a routine
  15-minute refresh stays a small request.
- `gpw/catalyst-terms-provider.ts` is a second, unrelated `gpw` endpoint —
  `gpwcatalyst.pl`'s instrument page, keyed by **ticker** (`GHE0128`), not
  ISIN (ADR 0023). Regexed against the raw markup, not flattened text
  (`mf/bond-issue-provider.ts`'s approach): the `</td><td>` boundary is what
  keeps the label pinned to its own value. `parseNominal` is exported so
  `gpw/catalyst-bond-lookup.ts` (below) can read the same page without a
  second regex for the same field.
- `bankier/client.ts` hits `api.bankier.pl` with no headers at all — verified
  live, there is no WAF here unlike `gpw`'s. `bankier/price-provider.ts`
  serves only `fund` (TFI/PPK units, keyed by bankier's own fund symbol, a
  third identifier alongside ISIN and the Catalyst ticker); it checks the
  response's own `profile_data.currency` against the instrument's stored
  currency and refuses on a mismatch, something `gpw`'s endpoint gives no
  data to do. A fund's valuation cadence is whatever bankier published — some
  value weekly, not daily — so bars are passed through exactly as returned,
  never resampled to fill a day the fund itself didn't quote.
- `bankier/search-instruments.ts` implements `InstrumentSearchProvider`
  against bankier's `instrument-search` API (Stage 6, ADR 0024) — a fund has
  one identifier used both to find and to price it, so this is a normal
  implementation, unlike the Catalyst case below. `confirm()` re-searches by
  the exact symbol (never trusts the candidate's own `name`, same ADR 0014
  gate as Yahoo's) and fetches `bankier-fund-chart-data` for the currency,
  since the search response never carries one.
- `gpw/catalyst-bond-lookup.ts` is a `CatalystBondLookup` (`core/bonds/
ports.ts`), **not** an `InstrumentSearchProvider` — a Catalyst bond has two
  identifiers (ticker, ISIN) for two different roles, which `confirm()`'s
  one-`symbol` contract can't carry (ADR 0024). `search()` scrapes the
  corporate-bond listing page (no search API exists on this site) and walks
  issuer/ticker links in document order, since the issuer cell is
  `rowspan`-grouped over every bond from that issuer; the page repeats this
  table 2-3 times (a hidden "export to Excel" variant), so results are
  deduped by ticker. `fetchListing()` reads the same instrument page
  `catalyst-terms-provider.ts` does, plus the ISIN (`id="isin"` hidden input)
  and issuer name (`Nazwa emitenta` row). Both this module's fetches and
  `catalyst-terms-provider.ts`'s go through `gpw/client.ts`'s shared
  `fetchGpwCatalystPage`, so they share one throttle queue against
  `gpwcatalyst.pl` rather than two independent ones.
