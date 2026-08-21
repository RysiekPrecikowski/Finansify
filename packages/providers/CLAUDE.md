# packages/providers

The external-data adapters: Yahoo Finance and GPW's own `chart-json.php` for
prices, Yahoo for instrument resolution, NBP for FX. See `docs/data-sources.md`
for what each source offers, ADR 0014 for why lazy ingestion was chosen, and
ADR 0022 for the provider chain and per-kind capabilities that let more than
one price source coexist.

## Rules

- Imports `@finansify/core` only, to implement its `valuation` ports; never
  imports `@finansify/db` or `apps/web` (adapters don't import each other —
  `docs/architecture.md`).
- One module per provider (`src/yahoo/`, `src/gpw/`, `src/nbp/`). Nothing in
  `src/yahoo/` may be imported from `src/gpw/` or `src/nbp/`, or vice versa.
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
