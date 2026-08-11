# Deployment

Everything runs on Vercel free tiers. One project, one app, one build.

## Vercel project

The repo is already linked (`prj_oteeszlvKgqREwxCswSVupcFkbUW`).

- **Root Directory `apps/web`.** Vercel detects the pnpm workspace and Turborepo
  and installs from the repo root. Turborepo remote caching is on by default for
  Vercel-linked repos.
- **`turbo-ignore` as the Ignored Build Step**, so commits touching only docs
  skip the build entirely.
- **Configuration belongs in `vercel.ts`** (`@vercel/config`) rather than
  `vercel.json`. The repo currently has neither, which means every monorepo
  setting lives invisibly in the dashboard where it cannot be reviewed or rolled
  back. Moving it into code is the fix.
- **`next.config.ts` needs** `typedRoutes: true`, `agentRules: true`, and
  `transpilePackages` listing the workspace packages. Cross-package imports do
  not resolve without the last one.

## Migrations

**Migrations never run during a build.** Vercel builds execute per deployment and
concurrently; running schema changes from one is a reliable way to corrupt it.

The flow instead:

1. `drizzle-kit generate` produces the migration; it is reviewed and committed
   alongside the schema change.
2. A GitHub Action on merge to main applies it with `drizzle-kit migrate` over
   the **unpooled** connection string.
3. Preview deployments get their own database branch, so every PR exercises the
   migration against a real copy before it reaches production.

Point 3 is a large part of why ADR 0008 leans the way it does.

## Environments

`.env.example` is committed, with variable names matching exactly what the
marketplace integrations emit — so `vercel env pull` produces a working
`.env.local` with no renaming step.

Two connection strings are needed and they are not interchangeable: the pooled
URL for the application, and the unpooled URL for migrations.

## CI

A single job on push to main and on every PR: install with a frozen lockfile,
then `pnpm check` — build, lint, typecheck, test, and format, cached via Turbo.

To add: a **migration-drift check** that fails if the schema and the generated
migrations disagree. Without it, a schema edit that never got a migration
generated passes CI and breaks on deploy.

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
