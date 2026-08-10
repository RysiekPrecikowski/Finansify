# 0001 — Next.js on Vercel with Supabase

**Status:** Superseded by [0008](0008-neon-clerk-migration.md)
**Date:** 2026-08-10

## Context

Two developers, no budget, no ops appetite. We need relational persistence, auth, private
file storage for broker uploads, and preview deployments. TypeScript end to end.

## Decision

- **App:** Next.js 16 (App Router) + React 19, deployed on Vercel.
- **Data:** Supabase Postgres.
- **Auth:** Supabase Auth.
- **Files:** Supabase Storage (private buckets) for uploaded broker files.
- **Everything else:** nothing. No extra services.

Free tiers on both, and the whole system is designed to stay inside them (ADR 0003).

## Alternatives

| Option                            | Why not                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Neon + separate auth provider     | Auth, storage and Postgres from one vendor is materially less wiring for two people                                          |
| Clerk + own Postgres              | Better auth UX, but another bill and another integration for a single-user MVP                                               |
| Dedicated Fastify/Express backend | A second deployable with no second consumer to justify it                                                                    |
| Turso / SQLite, local-first       | Real appeal, but the product is online-first and Postgres gives us `numeric` and window functions we will want for analytics |

## Consequences

- Vendor coupling is real, mostly in auth and storage patterns. The ledger itself is plain relational data and exports cleanly.
- Vercel Hobby caps cron at once per day — fine, because we run no cron (ADR 0003).
- **Supabase free projects pause after 7 days without database traffic.** Anything that pauses stops working entirely. If this project ever goes quiet for a week, expect to un-pause it manually or add a keepalive ping.
- Free tier ceilings worth knowing: 500 MB database, 1 GB file storage, 5 GB bandwidth.

## Revisit when

- The database approaches 500 MB, or file storage 1 GB.
- We need a second client (mobile) that should not depend on the web app's deploy lifecycle.
- Auth requirements outgrow what Supabase Auth does (SSO, organisations, fine-grained roles).
