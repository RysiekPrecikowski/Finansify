# 0018. The FX source is the reader's choice, scoped

**Status:** Accepted
**Date:** 2026-08-17
**Supersedes:** 0017, in part — see "What 0017 got right and what it overreached on"

## Context

ADR 0017 chose NBP table A for FX history and rejected Yahoo, on evidence that
still holds: the two disagree by 7-22 bps on a quiet day, and a chart sourced
from a different series than the portfolio total would disagree with the number
printed above it for no reason a reader could discover.

What it did not anticipate is that a reader might want the market number **on
purpose**, and know exactly why it differs. The request came with its own
reasoning: a rate that moves through the session is the answer to "what is
USD/PLN right now", and NBP's once-a-day fixing is not. The comparison against
Google Sheets' `GOOGLEFINANCE` was the specific ask.

0017's error was not the measurement. It was concluding, from "these two numbers
must not be silently mixed", that only one of them may exist in the product.

## Decision

**The source is a setting, with a scope.**

- **Source** — `nbp` (the daily fixing) or `yahoo` (the market quote).
- **Scope** — `charts`, which leaves every valuation on NBP and only moves what
  the reader is looking at; or `all`, which moves the portfolio valuation too.

The default is `nbp` / `charts`, which is exactly 0017's behaviour. A reader who
never opens the setting sees no change.

`valuationSource()` in `core/valuation/fx-source.ts` is the single place the
scope is applied. It only ever narrows: under `charts`, valuation reads NBP
whatever the reader picked to look at. No call site re-derives that rule.

## What 0017 got right and what it overreached on

**Right, and still binding:** a chart and the figure above it must come from one
series. That is why the scope exists at all rather than a bare source toggle —
picking Yahoo for charts alone leaves the portfolio on NBP and the two never
appear side by side claiming to be the same thing.

**Right, and now enforced in the schema:** the two feeds must not overwrite each
other. 0017 avoided the problem by having one feed. `fx_rates` now carries
`source` in its primary key (migration 0009), so a Yahoo close and an NBP mid
for the same currency-day are two rows. Every read names the source it wants; a
query that does not is a question with two correct answers.

**Overreached:** "a market feed is disqualified here." It is disqualified as a
_silent substitute_ and as the _default_. It is not disqualified as a labelled,
deliberate choice.

## The consequence this must not hide

Polish realized gains convert at the NBP rate from the business day preceding
the transaction (`docs/domain.md`). Under `yahoo` + `all`, the portfolio total
is therefore computed from a series the tax return will not use, and the two
come apart by the spread.

That is a real cost and it is the reader's to accept. `valuationDivergesFromTax()`
exists so the UI states it at the point of choosing and wherever a diverging
total is shown — not once, in a settings screen, where it would be consent in
name only.

This is deliberately not treated as a bug to be fixed later. The book stays
correct: cost basis and realized P&L are computed from the executed rate stored
on each transaction (rule 6, ADR 0006), which no display preference touches.
What moves is the _presentation_ of an unrealized total — the same thing ADR
0017's own "presentation restates the view, never the book" rule already
allowed.

## Consequences

**Yahoo becomes a second FX provider, behind its own port.** `FxQuoteProvider`
speaks pairs (`fetchSpot`, `fetchPairSeries`); `FxRateProvider` speaks NBP's
PLN-based table. One interface over both would mean a `fetchTableTo` on Yahoo
fanning out into thirty-odd requests to answer a question nobody asked.

**Market quotes are normalised to X/PLN before storage.** Every valuation
converts through PLN (`convertViaPln`), so storing the pair that way keeps the
two paths interchangeable at the point of use: swapping the source swaps which
rows come back and nothing else.

**A market quote carries an `Instant`, an NBP mid carries a `PlainDate`.** That
difference is the whole point — a fixing belongs to a publication day, a quote
belongs to a moment — so `FxQuote` is its own type rather than an `FxRate` with
a fuzzier date.

**The 15-minute TTL now means two different things**, and the table in
`docs/data-sources.md` says which is which: against NBP it is a polling interval
that keeps returning the same row until midday, against Yahoo it is a genuine
freshness bound.

**Yahoo's risks carry over from ADR 0014** — unofficial, no SLA, anti-bot gated.
Acceptable for a number the reader chose to look at; the default staying NBP is
what keeps that risk off the valuation path for anyone who never opts in.
