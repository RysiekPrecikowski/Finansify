# Architecture

One Next.js app on Vercel, one Supabase project, three packages. No other services.

```
Browser
   |
   v
Next.js on Vercel ......... UI, server actions, route handlers
   |            \
   |             `-------> Supabase Auth      (identity, sessions)
   v
packages/db ............... Drizzle -> Supabase Postgres  (all data access)
   |
   v
packages/core ............. money, FX, ledger, valuation  (pure, no I/O)
```

External reads: [NBP API](https://api.nbp.pl/en.html) for FX (free, no key), and a market
data provider for equity/ETF prices (**still undecided** — see [roadmap](roadmap.md)).

## The three packages

| Package         | Contains                                                        | Depends on   | Must never contain       |
| --------------- | --------------------------------------------------------------- | ------------ | ------------------------ |
| `packages/core` | Money, FX, ledger rules, valuation, bond schedules, zod schemas | nothing      | I/O, SQL, React, `fetch` |
| `packages/db`   | Drizzle schema, migrations, queries                             | `core`       | React, business rules    |
| `apps/web`      | Routes, server actions, components                              | `core`, `db` | financial calculations   |

The arrow only points one way: `web → db → core`.

`core` is pure because that is what makes it trivially testable — its tests need no
database, no network and no mocks. Any function that needs data takes it as an argument.

**These boundaries are enforced by ESLint, not by convention** (`eslint.config.mjs`). A
violation fails the build with a message telling you where the code belongs. That is
deliberate: it keeps the dependency graph traceable when code is written quickly, by
either of us or by an agent.

### Why not one package, or nine?

The previous iteration had nine. Most held under thirty lines of unused types, and the
build produced `dist/` output that nothing imported. Three is the smallest split that
still makes "where does this go?" answerable without judgement. See ADR
[0002](decisions/0002-three-package-workspace.md).

## No build step for packages

`core` and `db` export TypeScript source directly; Next transpiles them
(`transpilePackages`). So there is no `tsup`, no `dist/`, no build ordering, and no
orchestrator — `pnpm` alone runs the workspace. Vitest reads the same source the app does.

## How a request works

**Read:** Server Component → `packages/db` query → `packages/core` calculation → render.

**Write:** Server Action → parse with a `core` zod schema → `db` transaction (row + audit
event) → `revalidatePath`.

Rules that keep this honest:

- Every write is validated with a schema from `packages/core/src/contracts.ts`, shared with the client form so the two cannot drift.
- Every write to a user-owned row also writes an `audit_events` row, in the same transaction.
- Calculations never run in the browser. The client renders numbers; it does not produce them.

## Auth and data access

Supabase Auth owns identity; Drizzle owns data. Two libraries, two jobs, one query path.

The browser never queries tables — it only holds a session. Server code reads
`getCurrentUser()` and filters by `user_id`; RLS then independently enforces the same
thing in Postgres. Both layers are mandatory. See ADR [0004](decisions/0004-drizzle-with-supabase-auth.md).

## Two connection strings, on purpose

|                       | Port                               | Used by                                        |
| --------------------- | ---------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`        | 6543 (Supavisor, transaction mode) | the app at runtime — requires `prepare: false` |
| `DIRECT_DATABASE_URL` | 5432 (direct)                      | `drizzle-kit` migrations only                  |

Serverless functions open and drop connections constantly, so runtime goes through the
pooler. The pooler cannot run multi-statement transactions, so migrations must not.
Getting this backwards produces an app that works locally and fails on every query in
production. The connection is opened lazily on first query, so `next build` — which
imports every server module and has no database — does not fail in CI.

## Computation is lazy, not scheduled

There is no worker, no queue and no cron. Values are computed when someone asks for
them, then cached in Postgres; ledger writes invalidate the cache. Price and FX
observations are immutable historical facts, so once fetched they are cached forever.

This is what keeps the whole system inside free tiers. See ADR
[0003](decisions/0003-lazy-computation.md) for the trade-off and when to revisit.
