# 0008 — Neon + Clerk, replacing Supabase

**Status:** Accepted
**Date:** 2026-08-10

## Context

ADR [0001](0001-platform-vercel-supabase.md) picked Supabase specifically because one
vendor for Postgres, auth and storage was less wiring for two people, and explicitly
rejected "Neon + separate auth provider" and "Clerk + own Postgres" on that basis. No
Supabase project was ever provisioned, and no data-bearing feature exists yet beyond the
schema -- so revisiting this is a clean swap, not a migration with real data at stake.

Two things changed the calculus:

- Neon is Vercel's own preferred Postgres integration, with per-branch databases that
  fit this project's existing PR-preview workflow better than a single shared Supabase
  instance would.
- A future mobile client is a stated possibility (ADR [0002](0002-three-package-workspace.md)).
  Supabase's SSR auth is cookie-only; Clerk's `auth()` validates both a web cookie
  session and a mobile bearer JWT through the same call. That means a mobile client
  later is just new Route Handlers under `apps/web/src/app/api/**`, calling the same
  `packages/db` → `packages/core` path Server Actions already use today -- no new
  deployable, no separate backend to stand up. Nothing schedules mobile yet
  (`docs/product.md`), but this is why the migration is worth doing ahead of that need
  rather than after it.

## Decision

- **Data:** Neon Postgres, via the Vercel Marketplace integration.
- **Auth:** Clerk, via the Vercel Marketplace integration.
- **Driver:** unchanged -- `postgres-js`, same as against Supabase. Neon's pooled
  connection string (PgBouncer, transaction mode) still requires `prepare: false` for
  the same reason Supavisor did; the direct connection string is still migrations-only.
  See `packages/db/src/client.ts` and `packages/db/drizzle.config.ts`.
- **Row Level Security: dropped.** Supabase's RLS policies worked because Supabase
  auth issues `auth.uid()` inside Postgres for free. Neon has no equivalent, and Clerk
  doesn't populate one either -- the only way to get an equivalent second enforcement
  layer is to verify the Clerk JWT server-side and `SET LOCAL` a session variable per
  request/transaction, then write policies against `current_setting()` instead of
  `auth.uid()`. That's real custom wiring (a transaction-scoped query wrapper
  touching every call site in `packages/db`) to defend a single-user MVP where the
  app-level `user_id` filter is already mandatory. Not worth building yet.

  CLAUDE.md's hard rule ("every user-owned table gets RLS plus a user_id filter in
  code. Both.") is downgraded to app-level filtering only. That filter is now the
  _only_ enforcement layer: a missed one is a silent cross-user leak, not a
  Postgres-refused query.

- **Storage:** open again. ADR 0001 assigned broker file uploads to Supabase Storage;
  nothing is built against it, but that assignment no longer holds. Vercel Blob is the
  natural default when that feature gets built -- not decided here, just not silently
  dropped either.

## Alternatives

| Option                           | Why not                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Stay on Supabase                 | Already reconsidered once; Neon's branching and Clerk's mobile-token story won out           |
| Rebuild RLS via session variable | Real engineering for a threat model (single user, no second tenant) that doesn't need it yet |

## Consequences

- `packages/db/src/schema.ts`: `userId` columns are `text`, not `uuid` -- Clerk ids
  look like `user_xxx`, and there's no `auth.users` table to foreign-key against
  anymore. Ownership is asserted by the app, not the database.
- Losing RLS means every future query against a user-owned table needs its `user_id`
  filter checked in review, every time -- there's no second layer catching a mistake.
- Vendor coupling moves from one vendor to two (Neon, Clerk), each with its own
  dashboard and bill.

## Revisit when

- This app ever has more than one tenant sharing infrastructure trust (i.e. genuine
  multi-user, not just "another person's Clerk account exists").
- Compliance or audit requirements demand defense-in-depth beyond application code.
- At that point, rebuild RLS with the `current_setting()` / `SET LOCAL` pattern
  described above, rather than re-adopting Supabase.
