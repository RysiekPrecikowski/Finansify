# 0011. Bond terms resolved on first use

**Status:** Accepted
**Date:** 2026-08-11

## Context

Polish retail treasury bonds cannot be priced by any market-data provider. Their
value is computed from the terms of the specific issue the user bought, so
Finansify needs those terms for every series any user holds.

A series code such as `EDO0835` decomposes into two layers:

- **Family rules** — `EDO` means a 10-year tenor, CPI indexation, annual
  capitalization, a fixed early-redemption fee, and a known payout schedule.
  There are eight families and they change on the order of once a decade.
- **Per-issue parameters** — the `08/35` part identifies the issue month, which
  determines the first-period rate and the margin over the index. Two numbers,
  published monthly.

There is no API for either. The Ministry publishes emission letters and a monthly
offer as web pages; dane.gov.pl offers a single XLS with no REST endpoint.

The obvious approaches both fail. Committing all terms to the repository means a
user's position is blocked until someone opens a PR. Asking the user to type in
the terms means asking them to read an emission letter, and any mistake silently
mis-values the position for years.

## Decision

Bond terms **populate automatically the first time anyone holds a series**, and
are cached globally so every subsequent user gets them for free.

Family rules are versioned, effective-dated configuration in
`packages/core/src/bonds/families.ts` — they are domain knowledge, not fetched
data. The `BondTermsResolver` port composes them with fetched per-issue
parameters, writes the resolved `BondTerms` into the global `bond_series_terms`
table, and returns it. Cache-on-first-use, exactly like prices.

Resolution has three tiers, tried in order: automated fetch from the official
source, committed bootstrap data covering historical series, and a manual
override in the UI. See `docs/data-sources.md`.

## Consequences

Adding a bond position is just adding a bond position. The user types a series
code; nothing else is required of them, and no repository change gates their
data.

Adding a new _series_ requires no work at all — it resolves itself. Adding a new
_family_ is a config entry plus a golden test. This is what keeps eight bond
types from becoming eight special cases in the accrual engine.

The split matters: family rules are stable domain knowledge and belong in code
where they can be reviewed and tested; per-issue parameters are volatile data and
belong in a table. Putting either in the other's place is how this turns into a
mess.

The costs are real. The system depends on scraping a website that can be
redesigned without warning, and a wrong per-issue rate silently mis-values a bond
for its entire term — a ten-year error for EDO. This is why the fetcher must
validate hard and **refuse to write a value that fails a sanity check rather than
guessing**, and why the manual override exists as a permanent escape hatch rather
than a temporary one.

The bootstrap tier also means some committed data after all, but only for
history, so the fetcher never has to crawl years of archive and only ever handles
recent issues.

## Alternatives considered

**Commit all bond terms to the repository.** Fully deterministic, reviewable,
no scraping. Rejected because it puts a PR between the user and their own
position, and because it does not scale past the series we happened to think of.

**Ask the user to enter the terms.** No external dependency at all. Rejected
because it moves the risk to the least-equipped place: a user misreading an
emission letter produces a wrong number that looks authoritative and persists for
a decade.

**Scrape eagerly on a schedule**, populating every series in advance. Rejected —
it contradicts ADR 0003's no-scheduler stance, and it does work for series nobody
holds. Lazy resolution fetches exactly what is needed.

**Treat bonds as generic instruments with a manual price.** Simplest possible
implementation. Rejected because handling these properly is a large part of why
this product is worth building; no off-the-shelf tracker does it.
