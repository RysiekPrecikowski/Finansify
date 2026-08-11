# 0003. Ledger-first, everything derived on read

**Status:** Accepted
**Date:** 2026-08-11

## Context

The product promises portfolio values at daily, hourly, and fifteen-minute
resolution. The obvious reading of that is a scheduler writing snapshots into a
table on a timer.

But the value of a portfolio is a pure function of three things: the transaction
ledger, prices, and FX rates. Storing it is caching, and caching a derived value
introduces the possibility that it disagrees with the inputs that produced it.

There is also a platform constraint. Free-tier storage is finite, and snapshot
tables grow whether or not anyone looks at them.

## Decision

The transaction ledger is the system of record. **Positions, valuations, P&L,
allocation, and income are computed on read and never stored.**

The stated cadences are cache TTLs and chart granularities, not jobs. Freshness
comes from a three-layer cache — the shared market-data table, Next.js Cache
Components, and request-scoped memoization — with stale-while-revalidate driven
by `after()` on the request path.

**There is no cron and there are no background workers in v1.**

## Consequences

There is no stored number that can drift from the transactions that produced it.
Editing a transaction is automatically correct everywhere, which is what makes
the mutable ledger in ADR 0004 safe.

Historical valuation is free: `valuePortfolio(asOf)` works for any date without
having needed a snapshot at that date. A snapshot-based design can only show
history it happened to be running for.

Infrastructure stays trivial. No scheduler, no job queue, no worker, no
reconciliation between stored and computed values, and no backfill when the
calculation changes — which it will, repeatedly, in early phases.

The cost is read-time work. Valuing a portfolio means folding the whole ledger.
This is fine at the scale of a personal portfolio — thousands of rows — and would
not be at hundreds of thousands. The mitigation is the cache, and the exit is
already designed: snapshots can be added later as a cache layer behind the same
port, without changing a calculation.

Intraday history is limited by what the price cache retains rather than by
snapshots, which is why the retention policy in `docs/architecture.md` matters.

## Alternatives considered

**Snapshots every 15 minutes via cron.** Fastest reads and the richest intraday
history. Rejected for v1: it needs a scheduler, a backfill path, and storage that
grows regardless of use, all to solve a performance problem we do not have yet.

**Daily snapshots plus on-demand intraday.** A genuine middle ground, and the
most likely first extension. Deferred rather than rejected — it becomes
worthwhile once price-provider history gets expensive or unreliable, since a
snapshot is history we own.
