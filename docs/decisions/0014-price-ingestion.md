# 0014. Lazy price ingestion, single provider, exchange as a mandatory coordinate

**Status:** Accepted
**Date:** 2026-08-13

## Context

Phase 2 needs market prices and FX rates flowing into the ledger's valuation.
Three questions had to be settled before any adapter code was written: how
prices get fetched without spamming a free, unofficial API into banning us;
how an instrument gets mapped to a provider's ticker without silently pricing
the wrong listing; and whether a second provider is realistic at this stage.

Real requests against `yahoo-finance2` (v4.0.2) and Stooq answered all three
empirically, and one finding overturned an assumption this document used to
make.

**Yahoo covers GPW.** `PKN.WA` returns `currency: PLN`, `exchangeName: WSE`,
consistent with the `.WA` suffix convention already assumed.

**A bare `User-Agent: Mozilla/5.0` is sufficient**; no crumb, no cookie. The
unofficial `v8/finance/chart` endpoint 429s with no header at all, but a
single-header request succeeds reliably in manual testing.

**Stooq is dead.** Every `stooq.pl/q/d/l/?s=…` request now returns a
proof-of-work anti-bot challenge (SHA-256, difficulty 4, verified via POST to
`/__verify`). This was not true when `data-sources.md` was first written. There
is no free alternative with comparable GPW coverage — the realistic
alternatives are paid feeds (EOD Historical, Twelve Data), which changes the
"something free" premise this project is built on.

**ISIN does not resolve a listing — it identifies a security that can trade on
several.** `search('IE00B5BMR087')` returns exactly one listing (`CSSPX.MI`,
Milan, EUR), while the same ISIN also trades as `SXR8.DE` (XETRA, EUR 727.18)
and `CSPX.L` (LSE, **USD** 838.54). `IE00B4L5Y983` is worse: `IWDA.L` is
149.22 **USD**, `IWDA.AS` is 129.39 **EUR** — same fund, same moment, two
different currencies. Resolving by ISIN alone risks a plausible-looking wrong
valuation, not a missing one. Yahoo also never returns an ISIN back out of
`quoteSummary`, so a symbol-to-ISIN round-trip check is not possible; currency
and exchange from `quote()` are the only verifiable gate.

## Decision

**No scheduler.** Prices and FX are fetched lazily, on demand, from a
`<Suspense>` boundary that never blocks the initial render — `/portfolio`
reads only `instrument_prices`/`fx_rates`, streams in updates as they land,
and stays correct if the provider is down or slow. `apps/web/AGENTS.md`
already states "there is no cron"; this is that rule applied to prices.

**One provider, deliberately.** Yahoo (`yahoo-finance2`) for global and GPW
equity/ETF prices, NBP table A for FX. There is no free, working second source
for prices today, so resilience comes from the storage layer — a stale bar
with a visible timestamp is always preferred to inventing a number — not from
provider redundancy. `docs/data-sources.md`'s "keep a second implementation
working" and "stable free CSV endpoints" claims about Stooq are corrected in
the same change as this ADR.

**Exchange (MIC) is a mandatory coordinate for a priced instrument, not an
optional refinement of ISIN.** Resolution order: our own `(symbol, exchange)`
is the primary candidate; ISIN is a soft cross-check that only logs a mismatch
and never gates; `quote()`'s `currency` and `fullExchangeName` are the one hard
gate, and a mismatch refuses the mapping rather than guessing. An instrument
with no `exchange` cannot be priced automatically and queues for the manual
mapping screen.

**A missing latest price falls back to the last known price**, never to an
estimate — the existing rule from `CLAUDE.md` and `data-sources.md`, restated
here because it is what makes "one provider, no scheduler" acceptable: a stale
number with its date is honest; a synthetic one is not.

**FX enters Phase 2's scope.** A portfolio mixing PLN, EUR, and USD positions
has no total without a current conversion rate, so `fx_rates` (NBP table A,
mid, carried forward on non-publishing days) ships alongside prices rather
than being deferred.

## Consequences

Provider risk is now openly concentrated: Yahoo is unofficial, has no SLA, and
can change its response shape or block us without notice. The mitigation is
architectural, not a fallback provider — `instrument_prices` and `fx_rates`
are the system of record, and every read path already treats "provider down"
as "serve what's stored" rather than as an error. Losing Yahoo entirely would
stop new prices from arriving, not corrupt or hide existing ones.

Naive lazy fetching, without a per-instrument lock, is accepted for the same
reason it is safe: `instrument_prices`' primary key is `(instrument_id,
date)`, so two concurrent refreshes both upsert cleanly. The cost is a wasted
duplicate request under concurrent load, never a data race. A fetch lock is
future work, not a prerequisite.

Exchange becoming mandatory for pricing has a migration consequence:
`instruments.exchange` stays nullable at the column level — other instrument
kinds (a bond, say) don't need it — but any instrument without one is
unvaluable until someone fills it in via the mapping screen (PR 6). This is a
deliberate refusal to guess a listing from currency alone, which the ISIN
evidence above shows is exactly the class of error that produces a
plausible-looking wrong number.

Choosing a library (`yahoo-finance2`) over a hand-rolled client for Yahoo, and
the reverse for NBP, is also decided here: Yahoo needs `search()` and
`quote()` in addition to `chart()`, each with its own crumb/session handling
the library already solves; NBP is one stable, documented, unauthenticated
endpoint, where a dependency buys nothing a dozen lines of `fetch` + `zod`
don't already provide.

## Alternatives considered

**Scheduled background refresh (cron / Vercel cron).** Rejected outright —
contradicts the project's standing no-scheduler position and fetches data
nobody may be looking at.

**ISIN as the primary resolution key**, with exchange as a tiebreaker only
when ISIN search returns multiple hits. Rejected once real data showed
`search()` returns exactly one listing even when several exist — there is no
"multiple hits to disambiguate" signal to react to; the wrong listing looks
identical to the right one until compared against exchange and currency
directly.

**A second free price provider (Stooq).** Investigated and rejected — see
Context. Revisit only if a free source with real GPW/global coverage appears;
a paid feed is a different decision (cost, not architecture) and out of scope
here.

**Guess a missing `exchange` from an instrument's currency.** Rejected for the
same reason ISIN-only resolution was: currency does not determine listing
(`CSPX.L` is USD despite trading in London), so this would silently reproduce
the exact failure mode this ADR exists to avoid.
