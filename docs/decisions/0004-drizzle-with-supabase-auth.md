# 0004 — Drizzle for data, Supabase for auth

**Status:** Superseded by [0008](0008-neon-clerk-migration.md)
**Date:** 2026-08-10

## Context

Supabase ships a JS client that can query tables directly from the browser, with RLS as
the only thing standing between a user and everyone else's data. It is fast to start with
and a poor fit here: financial calculations must not run client-side, and we want one
typed query path rather than two.

## Decision

Split the responsibilities:

- **Supabase Auth** owns identity — sign-in, sessions, `auth.users`. The browser holds a session and nothing else.
- **Drizzle** owns all data access, server-side only. Schema in `packages/db/src/schema.ts`, migrations generated into `packages/db/drizzle/`.

**The browser never queries a table.** Reads happen in Server Components, writes in Server
Actions.

Authorization is enforced twice, deliberately:

1. Server code filters by `user_id` from `getCurrentUser()`.
2. RLS policies scoped to `auth.uid()` enforce the same rule in Postgres.

Neither is optional. Application code is where the bug will be; RLS is what stops that bug
becoming a data leak.

Use `supabase.auth.getUser()` on the server, never `getSession()` — `getUser()` revalidates
the token, while a session read trusts a cookie the client controls.

## Alternatives

| Option                            | Why not                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| Supabase JS client for everything | Two query paths, weaker types, and it invites querying from the browser |
| Prisma                            | Heavier codegen, historically awkward with RLS and Supabase's pooler    |
| Raw SQL                           | Fine for the queries, no help for schema drift or migrations            |

## Consequences

- Two connection strings, and getting them backwards is a production-only failure. Documented in `architecture.md` and enforced by comments at both call sites.
- `drizzle-kit` does not generate RLS policies. They are hand-written in `0001_enable_rls.sql`, and **every new user-owned table needs a matching policy added by hand.**
- Drizzle does not know about `auth.users`, so the foreign keys to it are declared in raw SQL rather than in the schema file.

## Revisit when

- Realtime subscriptions are needed (that is the Supabase client's actual strength).
- RLS policies grow complex enough that duplicating the rule in application code stops being obviously correct.
