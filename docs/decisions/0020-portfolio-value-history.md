# 0020. Portfolio value history: derived on read, backfilled once per instrument

**Status:** Accepted
**Date:** 2026-08-19

## Context

CU-869ej7zk8 asks for the dashboard's hero chart to show real portfolio value
over time. Three constraints came with it, in the ticket and in the
conversation that scoped it:

- The chart must render as fast as possible, with whatever part is still
  loading visibly marked, rather than blocking on a full backfill.
- Whatever caching this adds must not become a second source of truth that can
  drift from the ledger — the risk explicitly named was "nieprawidłowe dane"
  (wrong data) surviving an edited or re-imported transaction.
- Backfilling years of daily history from Yahoo must not risk the rate limit
  ADR 0014 already treats as a real constraint (no SLA, unofficial API,
  actively anti-bot gated elsewhere in this project's own history with Stooq).

## Decision

**No new stored series. The chart is derived on read, every time**, from the
same tables ADR 0003 already treats as authoritative: the ledger
(`transactions`) and the global market-data cache (`instrument_prices`,
`fx_rates`). `packages/core/src/valuation/value-series.ts`'s
`portfolioValueSeries` folds the ledger forward day by day and prices each
day's holding from whatever price/FX history is on hand, carrying the last
known value forward across a gap (rule 7 — carry-forward is not interpolation,
it is the market's own last answer) and marking a point `partial` when nothing
covers it.

A `portfolio_value_daily`-shaped snapshot table was the alternative, and it is
what ADR 0003 already argues against: it would need its own ADR to reopen that
decision, and it would need invalidation on every ledger mutation, every
import, and every backfill — exactly the surface a "wrong number survives an
edit" bug lives in. Deriving on read makes that bug structurally impossible:
there is nothing to invalidate, because nothing is stored beyond the inputs
that were already global and already correct.

**What is cached is the input, not the output.** `instrument_prices` and
`fx_rates` are facts about the world — permanent, shared, and already the
source both `/portfolio` and the dashboard trust today (ADR 0010, ADR 0014).
Backfilling them, once, is the actual performance story; folding a ledger of a
few hundred transactions against a few hundred price points is milliseconds,
not a rendering concern.

**Two new tables answer "what have we already asked for", not "what do we
hold"**: `instrument_price_coverage` and `fx_rate_coverage`
(`packages/db/src/schema/prices.ts`), one row per `(instrument, source)` /
`(currency, source)` holding the earliest date a backfill has ever requested.
This is the mechanism that actually protects the rate limit. `min(date)` in
`instrument_prices` cannot distinguish "nobody has asked for history before
this" from "the provider has nothing earlier" — a newly listed instrument, a
delisting, a currency NBP's archive doesn't reach. Without an explicit record
of what was _asked for_, a MAX-range chart would re-request the same
unanswerable window on every render, forever. Coverage is written even when a
provider returns nothing, and only ever widens (`LEAST` on `covered_from`) —
never shrinks, so a narrower later call cannot undo a wider earlier backfill.

**A full backfill is one provider request per instrument, ever.**
`fetchDailyBars`/`fetchSeriesTo` already return an instrument's or currency's
whole history in one call (or, for NBP, one call per 367-day chunk its own API
limits impose). `makeBackfillPriceHistory` bounds a single round to
`BACKFILL_BATCH` (8) instruments and reports the rest as `remaining`, so a
portfolio with more instruments than one round covers keeps making progress
across renders instead of blocking the first one on all of them.
`callYahoo`'s existing ~1 req/s throttle and 429 backoff (ADR 0014) are
untouched and sufficient at this request volume.

**The read path is two functions, not one**, so "fast first paint" and "more
data landing" are two different requests rather than one slow one:

- `readValueSeries` — storage only, no network. Safe to call from the render
  path; this is what makes the chart appear immediately with whatever is
  already cached, exactly as ADR 0014's stale-while-revalidate pattern already
  does for the single-`asOf` price.
- `refreshValueSeries` — one bounded backfill round, then the same read.
  Called only from `GET /api/portfolio/value-series?refresh=1`, never from a
  server component's render.

Both return `pending: boolean` — true when some instrument or currency in the
window has not yet been asked for as far back as the window needs. A client
keeps calling the `refresh=1` route while `pending` is true and stops when it
turns false or an error is reported, which is what lets the UI mark "still
loading" honestly instead of guessing.

**Grain and range are request parameters, not stored properties.**
`SeriesGrain` (`day` | `week` | `month`) is chosen per request —
`defaultGrainFor` picks `day` up to a year, `week` up to five years, and
`month` beyond that, but a caller may override it. `historyFor` on both
`MarketPriceRepository` and `FxRateRepository` buckets in SQL
(`DISTINCT ON (id, date_trunc(grain, date))`, last close per bucket) so a
five-year MAX chart returns hundreds of points, not thousands, and prepends
one anchor row strictly before the window so carry-forward has something to
carry on day one.

## Consequences

**The chart's last point is provably the dashboard headline.** Both read the
same `instrument_prices`/`fx_rates` rows through the same carry-forward and
conversion rules; `portfolioValueSeries`'s test suite asserts this parity
directly against `valuePositions`' `totalMarketValue`; a chart and a headline
disagreeing is a bug, not a modelling difference, and is caught by that test.

**A missing price is still never interpolated.** A day with no bar at or
before it (never fetched, or genuinely nothing published — a pre-listing gap)
produces a `partial` point that names the unpriced instrument, exactly ADR
0014 and rule 7's existing stance carried through to a series instead of a
single value.

**Bond history has a known gap.** `bondUnitValuesFor`
(`apps/web/src/server/bond-valuation.ts`) can only reconstruct a bond's
historical per-unit value from lots that are still open _today_ —
`buildPositions`' FIFO matching has already consumed a fully-redeemed lot out
of `Position.lots` by the time `listPositions()` returns it, so there is
nothing left to accrue backward from. A bond position closed entirely before
"today" is invisible to the chart for the whole period it was held. This
degrades to `partial`/absent, never a fabricated number (rule 7 holds), and is
tracked as a known limitation rather than solved here — full historical lot
reconstruction is a materially larger change than this ticket's scope.

**Historical FX is always NBP**, even for a reader who has opted Yahoo into
today's valuation (ADR 0018). Building a second historical FX path for a chart
that already labels its source the way the FX pair card does was judged not
worth it; this is stated explicitly in the PR rather than left for someone to
discover as a discrepancy.

**Splits are not handled.** `buildPositions` already throws
`UnsupportedTransactionTypeError` on a `split` transaction rather than
guessing an adjustment factor; `portfolioValueSeries` inherits that refusal.
Yahoo's own daily closes are split-adjusted, so an instrument that split
during the holding period would draw a wrong shape if this were silently
allowed — refusing is the same choice ADR 0004's ledger design already made,
extended to a new caller.

**Two new tables, both global and unscoped** — `instrument_price_coverage` and
`fx_rate_coverage` describe what has been asked of a provider, not anything
about a user, so neither carries a `user_id` (ADR 0010, rule 5). `historyFor`,
`coverageFor`, and `markCovered` were added to the existing
`MarketPriceRepository`/`FxRateRepository` ports rather than new ports — same
tables, same adapters, a genuinely additive capability (rule 13).

**No `use cache` boundary yet.** `readValueSeries` takes every cache-key input
(`userId`, range, grain, presentation currency) as an explicit argument
specifically so a Cache Components boundary can be wrapped around it later
without changing any caller — but Cache Components are off for this app today
(`next.config.ts`), and turning them on is a separate, broader decision than
this ticket. If profiling ever shows the per-request fold is worth caching,
that cache still must take the user id as an argument (rule 5) — the same
footgun `apps/web/AGENTS.md` already calls out for every other per-user read
model.
