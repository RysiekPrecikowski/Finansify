# 0003 — Lazy computation instead of background jobs

**Status:** Accepted
**Date:** 2026-08-10

## Context

The original design called for an always-on worker service running `graphile-worker` on
Fly.io or Railway, handling scheduled price/FX ingestion and asynchronous, replayable
recalculation.

Two problems:

1. **Neither platform has a free tier in 2026.** Fly.io offers a 2-VM-hour trial; Railway a one-time $5 credit. An always-on worker means a bill and a second deploy pipeline, permanently.
2. **Nothing needs it yet.** The same design specified synchronous recompute for the first four phases. The worker would have sat idle through most of the MVP.

Vercel's Hobby cron is capped at one run per day, so that is not a substitute for scheduled
ingestion either.

## Decision

**No worker, no queue, no cron.** Compute on demand, cache the result in Postgres.

- A request for a valuation computes it server-side and stores the result.
- Subsequent requests read the cached row.
- A ledger write invalidates the affected cached rows.
- Price and FX observations are fetched on demand for the dates a calculation needs, then stored permanently — a historical EOD price is an immutable fact, so it is cached forever and fetched at most once.
- Only "today's" values carry a short freshness window.

The cache is keyed by scope, date, display currency and a **calculation version**. Bumping
the version invalidates everything — which is how a formula fix gets rolled out, and
preserves the replayability the worker was meant to provide.

## Alternatives

| Option                             | Why not                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always-on worker + graphile-worker | ~$5/mo minimum, second deploy pipeline, idle for four phases                                                                                                      |
| Vercel cron                        | Once per day on Hobby, and no retries or backpressure                                                                                                             |
| Supabase `pg_cron` + `pgmq`        | Genuinely good and free. But it is still scheduled infrastructure for a single user whose data changes when _they_ type. Lazy is simpler and strictly less to run |

## Consequences

- **The first request after a ledger change is slow** — it recomputes. Acceptable for one user with a few hundred transactions; not acceptable at scale.
- No pre-warmed data. Nobody's dashboard is ready before they open it.
- Fetching prices inside a request couples page latency to a third-party API. Cache aggressively and fail to a visible gap rather than blocking.
- Zero additional infrastructure, zero additional cost, one deploy target.

## Revisit when

- A cold recompute approaches the Vercel function timeout.
- We want data fresh _before_ someone asks for it (email digests, alerts, snapshots at a fixed daily cutoff).
- The product ever serves more than the two of us.

The successor is almost certainly Supabase `pg_cron` + `pgmq` — still free, still no extra
host — not a separate worker service. Write a new ADR when it happens.
