# 0010. Market data shared globally, portfolio data isolated per user

**Status:** Accepted
**Date:** 2026-08-11

## Context

Finansify's data splits cleanly along a line that is easy to state and dangerous
to get wrong.

The closing price of VOO on 11 August is the same fact for every user. Fetching
it once per user wastes free-tier provider quota, multiplies latency, and can
produce different users seeing different values for the same instrument.

A portfolio valuation is the opposite: it is private, and showing one user's to
another is the worst bug this product could have.

Both kinds of data flow through the same caching machinery, which is what makes
this worth writing down.

## Decision

**Market data is global and unscoped.** `instruments`, `instrument_identifiers`,
`prices`, `fx_rates`, `index_observations`, and `bond_series_terms` carry no
`user_id`. One fetch serves every user, and cache entries are keyed by instrument
and date only.

**Everything else is user-scoped**, reached only through `forUser(userId)` per
ADR 0009.

At the Next.js caching layer, the rule is explicit: **every `use cache` boundary
over user data takes the user id as an argument** so it participates in the cache
key. Read models are tagged `user:{id}` and `portfolio:{id}`, and ledger
mutations call `updateTag(...)`.

## Consequences

Provider quota scales with the number of **instruments**, not the number of
users. This is what makes free-tier market data viable if Finansify ever becomes
public — the hundredth user holding VOO costs nothing.

Two users holding the same instrument see the same number, which is table stakes
and would not be guaranteed by per-user caching.

Prices also become cheap to warm: the more users, the better the cache. A
per-instrument fetch guard is still needed so concurrent dashboard loads do not
stampede the provider.

The cost is a genuine footgun. Two caching regimes run through the same
mechanism, and the difference between them is one argument to a cached function.
Omitting the user id from a `use cache` key over a valuation leaks one portfolio
to another user, and it will not fail loudly — it will look like a cache hit.

Mitigations, all deliberate: the rule is invariant 5 in `/CLAUDE.md`, it is
repeated as a callout in `docs/architecture.md`, and it gets an explicit
end-to-end test — sign in as A, load the dashboard, sign in as B, confirm B sees
nothing of A's. That test exists because this is the one failure mode not worth
assuming away.

Sharing instrument records globally also means one user's typo in an instrument's
name is visible to everyone, so instrument creation and editing needs more care
than a per-user table would.

## Alternatives considered

**Cache prices per user.** Trivially safe — one regime, no footgun. Rejected on
quota and consistency: it multiplies provider calls by user count and lets two
users disagree about the same closing price.

**A separate cache store for shared data** — Vercel Runtime Cache or Blob for
prices, the database only for user data. Attractive, because the separation
becomes physical rather than conventional and the footgun largely disappears.
Deferred rather than rejected: it is the natural move if storage pressure appears
(see ADR 0008), and the `PriceCache` port already makes it a contained change.

**Per-user instrument records.** Would avoid shared-edit issues. Rejected as
duplicating a global fact once per user, which reintroduces the consistency
problem the price cache exists to solve.
