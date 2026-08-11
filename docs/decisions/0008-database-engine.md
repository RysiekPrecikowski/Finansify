# 0008. Database engine

**Status:** Accepted
**Date:** 2026-08-11

## Context

The database must fit a free tier indefinitely, hold a ledger that is the one
irreplaceable asset in the system, and be replaceable without a rewrite. The
candidates are Neon (serverless Postgres) and Turso (libSQL/SQLite).

### The reframing that mostly dissolves the question

The schema holds two very different kinds of data:

- **System of record** — `users`, `accounts`, `transactions`, `import_*`. Small,
  precious, transactional. A few thousand rows per user; well under 10 MB even
  for a heavy user.
- **Cache of public facts** — `prices`, `fx_rates`, `index_observations`,
  `bond_series_terms`. Large, disposable, rebuildable from providers at any
  time, identical for every user.

Only the second stresses storage. Sizing it: 15-minute bars over an eight-hour
session are roughly 32 bars/day/instrument, about 8k rows/year/instrument, around
0.5 MB/year/instrument. Fifty instruments over five years is roughly 125 MB.
Daily bars are negligible at about 250 rows/year.

With the retention policy in `docs/architecture.md` — `m15` for 30 days, `h1` for
a year, `d1` forever — the cache lands in the tens of megabytes, and **Neon's
0.5 GB free tier stops being the binding constraint.** If it ever becomes one,
the cache can move out of the primary database entirely, because it already sits
behind the `PriceCache` port.

### Comparison

|                    | **Neon (Postgres)**                                                                    | **Turso (libSQL/SQLite)**                                                                      |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Free tier          | 0.5 GB storage, 100 CU-hours/mo, 10 branches, scale-to-zero                            | 5 GB storage, 500M row reads/mo, 10M row writes/mo, 100 databases                              |
| Money type         | **`NUMERIC` — exact decimal, natively**                                                | **No decimal type.** Money is TEXT or integer minor units; every `SUM()` moves into TypeScript |
| Analytics SQL      | Window functions, `generate_series`, `date_trunc`, lateral joins                       | Weaker: no `date_trunc`, no `generate_series` (recursive CTEs), limited windowing              |
| Semi-structured    | `JSONB` with GIN indexes                                                               | `json_*` over TEXT, weaker indexing                                                            |
| Vercel integration | Marketplace one-click, env vars injected, **a database branch per preview deployment** | Manual env management                                                                          |
| Latency            | Scale-to-zero cold start after idle — with two users this happens often                | No cold start; embedded replicas                                                               |
| Vendor stability   | Mature; Databricks-owned since 2025                                                    | Mid-transition: libSQL is production and powers Turso Cloud, while the Rust rewrite is in beta |
| Drizzle support    | Yes                                                                                    | Yes — the ORM is not the differentiator                                                        |

## Decision

**Neon**, provisioned through the **Vercel Marketplace, Neon-Managed
Integration** (billing stays in Neon; Vercel gets an isolated database branch
per preview deployment). Three reasons specific to this domain rather than
general preference:

1. **Exact decimal money is native.** Losing `NUMERIC` is survivable — ADR 0005
   does the arithmetic in `decimal.js` regardless — but it permanently removes
   the SQL escape hatch and turns every ad-hoc question about the data into a
   program rather than a query.
2. **A database branch per preview deployment** means migrations are exercised on
   every PR against a real copy. For a project where the ledger is the
   irreplaceable asset, that is a meaningful safety property.
3. The storage constraint is dissolved by the reframing above, so Turso's
   headroom advantage buys less than it first appears.

Cold start (a few hundred ms after 5 minutes idle, by default) was weighed
against Turso's zero-cold-start replicas and judged immaterial at two-user
scale — a one-time delay on return, not a standing cost.

Revisit only if the retention policy starts feeling restrictive in practice, or
if cold starts become visibly annoying. Both are observable within weeks of
real use.

## Consequences

Whichever way this resolves, the real protection is ADR 0001: `packages/db` is
the only place in the repository containing SQL. Switching engines means
reimplementing the repository interfaces and running the unchanged `core` test
suite — a bounded, verifiable task rather than a rewrite.

That is worth stating plainly, because it is the actual answer to the vendor
lock-in concern that motivated this whole architecture: **the boundary is the
protection, not the choice of vendor.**

Choosing Turso would additionally mean deciding how money is represented at rest
(TEXT versus integer minor units), moving aggregation into application code, and
tracking the libSQL-to-Turso migration.

## Alternatives considered

**Supabase.** Postgres with auth included, which would also replace Clerk.
Rejected for stronger vendor coupling across two concerns at once, against a
design whose main goal is keeping those concerns separable.

**SQLite on a persistent volume.** No managed service at all. Rejected as
incompatible with Vercel's execution model.
