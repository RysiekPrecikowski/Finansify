# packages/providers

The external-data adapters: Yahoo Finance for prices and instrument
resolution, NBP for FX. See `docs/data-sources.md` for what each source
offers and ADR 0014 for why lazy, single-provider ingestion was chosen.

## Rules

- Imports `@finansify/core` only, to implement its `valuation` ports; never
  imports `@finansify/db` or `apps/web` (adapters don't import each other —
  `docs/architecture.md`).
- One module per provider (`src/yahoo/`, `src/nbp/`). Nothing in `src/yahoo/`
  may be imported from `src/nbp/` or vice versa.
- `numeric` values become `Decimal`/`Money` at the edge of this package —
  never `Number()`, never `parseFloat` (rule 1). Yahoo's bar closes arrive as
  float32 artifacts (`155.67999267578125`); round through
  `Decimal(...).toDecimalPlaces(meta.priceHint)` before they leave this
  package.
- Section 06 of the ingestion plan governs `yahoo/resolve-symbol.ts`:
  exchange (our own `(symbol, exchange)` + a MIC→suffix table) is the primary
  candidate, ISIN is a soft cross-check that only logs, and `quote()`'s
  `currency`/`fullExchangeName` is the one hard gate. Do not let ISIN gate a
  mapping — Yahoo's `search()` returns exactly one listing per ISIN even when
  several exist, so trusting it silently prices the wrong listing.
- Requests are serialized (~1/s) and retry on `429` with backoff
  (1s/4s/16s, 3 attempts) inside the adapter. The cross-instrument circuit
  breaker (stop the whole refresh round after two consecutive failures) lives
  in `core`'s `makeRefreshPrices`, not here — this package only handles a
  single request's own retries.
