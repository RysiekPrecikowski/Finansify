# Deployment

Everything runs on Vercel free tiers. One project, one app, one build.

## Vercel project

The repo is already linked (`prj_oteeszlvKgqREwxCswSVupcFkbUW`).

- **Root Directory `apps/web`.** Vercel detects the pnpm workspace and Turborepo
  and installs from the repo root. Turborepo remote caching is on by default for
  Vercel-linked repos. This is a dashboard-only Project Setting — Vercel does
  not expose it through `vercel.json` or `vercel.ts`, so it cannot move into
  code and stays undocumented there by necessity, not oversight.
- **`turbo-ignore` as the Ignored Build Step**, via `ignoreCommand` in
  `vercel.ts`, so commits touching only docs skip the build entirely.
- **Configuration belongs in `vercel.ts`** (`@vercel/config`) rather than
  `vercel.json`, for everything Vercel does expose that way — build/install
  commands, the ignore command, routing. `vercel.ts` at the repo root already
  sets `ignoreCommand`.
- **`next.config.ts` needs** `typedRoutes: true`, `agentRules: true`, and
  `transpilePackages` listing the workspace packages. Cross-package imports do
  not resolve without the last one.

## Migrations

**Migrations never run during a build.** Vercel builds execute per deployment and
concurrently; running schema changes from one is a reliable way to corrupt it.

The flow instead:

1. `drizzle-kit generate` produces the migration; it is reviewed and committed
   alongside the schema change.
2. `ci.yml`'s `migrate` job applies it with `drizzle-kit migrate` over the
   **unpooled** connection string, `needs: check` so it never runs against a
   commit that failed `pnpm check`. It is deliberately a job in `ci.yml`
   rather than a `workflow_run`-triggered workflow: gating on
   `github.event_name == 'push'` means a fork PR — which only ever produces a
   `pull_request` event — cannot reach it at all, rather than relying on a
   provenance check to filter one out. Requires the `DATABASE_URL_UNPOOLED`
   repository secret; until Neon is provisioned and that secret is set, the
   job fails rather than silently doing nothing.
3. Preview deployments get their own database branch, so every PR exercises the
   migration against a real copy before it reaches production.

Point 3 is a large part of why ADR 0008 leans the way it does. It is **not yet
wired**: preview deployments currently share whatever `DATABASE_URL` the Vercel
project has, so a migration first meets a real database on merge, not on the PR.

## Environments

`apps/web/.env.example` is committed, with variable names matching exactly what
the marketplace integrations emit — so `vercel env pull` produces a working
`.env.local` with no renaming step:

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` — Neon, via the "Neon-Managed
  Integration" (ADR 0008).
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk (ADR 0009).

Two connection strings are needed and they are not interchangeable: the pooled
`DATABASE_URL` for the application, and the unpooled `DATABASE_URL_UNPOOLED` for
migrations.

## CI

One workflow, `ci.yml`, on push to main and on every PR:

- **`check`** — install with a frozen lockfile, then `pnpm check` (build, lint,
  typecheck, test, format, cached via Turbo), then the **migration-drift check**:
  `drizzle-kit generate` must produce nothing, or `src/schema` and `migrations/`
  have diverged and the divergence would reach production as a table that does
  not match the code reading it. Runs for both events, and needs no database —
  `generate` diffs the schema against the migrations already on disk.
- **`migrate`** — `needs: check`, and only on `push` to `main`. See Migrations
  above.

The drift check is deliberately not part of `pnpm check`: that command runs
before every commit and must not write files. A locally green `pnpm check`
therefore no longer implies green CI — run `pnpm --filter @finansify/db
db:generate` after any schema edit, which the `db-migration` skill already does.

Vercel's own Git integration handles deployment; CI does not deploy.

## Observability

`@vercel/analytics` and `@vercel/speed-insights` are already wired into the root
layout. Add structured server logs carrying a request id. Sentry later, if and
when there are users to be sorry to.

## Scheduled work

**There is none in v1**, and that is deliberate — see ADR 0003. Freshness comes
from cache TTLs plus `after()`, not from a scheduler.

The `/api/cron/*` route shape is reserved for when daily close snapshots become
worthwhile. Adding the first cron is a boundary change and needs an ADR.
