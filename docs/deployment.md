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

Point 3 is a large part of why ADR 0008 leans the way it does, and it is now
live: the Neon-Managed integration creates a `preview/<git-branch>` database per
preview deployment. That is also what makes the branch budget below a real
constraint rather than a theoretical one.

## Migrations rehearse before they land

Migrations run **twice** on a merge to `main`: against `pre-production` first,
then against production only if that succeeded (ADR 0017). `migrate-production`
`needs: migrate-preproduction`, so there is no path to production that skips the
rehearsal.

`pre-production` is a **persistent** Neon branch, cloned from production. It is
the one branch deliberately exempt from rule 18's "never create a branch by
hand" — it is owned by no PR and nothing reaps it, on purpose. Reset it from
production ("reset from parent") whenever it has drifted far enough that a
migration passing there stops meaning anything.

It is also what local development points at: `vercel env pull --environment=development`
hands out its connection string, so a hand-run `db:migrate` lands somewhere that
is checked rather than on a branch nobody looks at again.

### The one rule that keeps the gate honest

`pre-production` is both the CI gate and the branch you break by hand. Those
roles conflict: a branch left in a broken state fails `migrate-preproduction`
on the next merge, for a migration that is perfectly fine, and the failure reads
as a bad migration rather than as yesterday's experiment.

**Reset it from parent before you push anything to `main`.** Neon Console →
`pre-production` → _Reset from parent_. Whoever broke it resets it. This is a
convention rather than a mechanism, chosen over a second branch because ten
slots is the whole budget and there are two of us (ADR 0017).

The failure it prevents is not hypothetical: on 2026-08-16 a hand-run
`db:migrate` against the development branch left it with a journal row for a
migration that never merged, so every later run died on `CREATE TYPE ... already
exists` — the same wedge that hit production, on the branch that was supposed to
catch it.

### Why this exists, concretely

**`neon-http` cannot run a multi-statement transaction.** A migration that fails
partway leaves the statements that already ran committed and never records its
journal row. The next run restarts the same file and dies on its first
`CREATE TYPE`; the database stays wedged until someone drops the half-created
objects by hand.

On 2026-08-16 that happened to production. `check` stayed green, so five further
merges landed on a database that was no longer being migrated. `drizzle-kit
migrate` exits 1 with no message, so the log said nothing about why.

Both halves are addressed: the rehearsal moves the wedge to a disposable branch,
and `packages/db/scripts/migrate.ts` replaces `drizzle-kit migrate` so the
failing statement and the driver's own error reach the log.

**A failed migration does not roll back.** Recovering means dropping whatever the
partial run created, then re-running — which is survivable on `pre-production`
and unpleasant on production. That asymmetry is the whole reason for the gate.

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

### Test user

Clerk sign-up is restricted (ADR 0009, rule 4) — nobody can self-register, which
otherwise blocks a fresh clone at the sign-in screen. Instead of inviting each
collaborator individually, there is **one shared test account**, created by hand
in the Clerk Dashboard (Users → Create user) rather than through the sign-up
flow, so it needs no email verification:

- Email/password are stored as `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` Vercel
  env vars, scoped to Development and Preview (never Production) — `vercel env
pull` delivers them to anyone with access to the Vercel project, so the
  credentials never need to travel over Slack or email.
- Rotate by creating a new password for the same Clerk user and re-running
  `vercel env add TEST_USER_PASSWORD development preview` (add `--force` to
  overwrite); no code change needed.
- This account exists purely to unblock local/preview testing. It is not a
  stand-in for real per-user auth testing — invite a real email in the Clerk
  Dashboard if a change needs verifying against actual sign-up/invite flows.

**`GET /api/dev/test-login`** signs the browser in as this account without a
password ever being typed anywhere — it mints a Clerk **Agent Task**
(`clerkClient().agentTasks.create`), Clerk's own mechanism for "agent-driven
flows where full authentication isn't practical." Visiting the returned URL
creates a session and redirects back to the app; there is no client-side
sign-in step, `/sign-in` is untouched. Built for driving the app through
browser automation (an agent, a screenshot check, a smoke test) where typing a
credential into a form field isn't an option. Refuses to run when
`VERCEL_ENV === 'production'`.

This is deliberately unauthenticated on top of that guard: anyone who has (or
guesses) a dev/preview URL can hit the endpoint and get a session as the test
user. Acceptable because the account carries no real financial data — do not
reuse this pattern for an account that does.

**Playwright does not use that route.** It redirects to a Clerk-hosted URL, so
the browser leaves the app's origin and returns through Clerk's dev-browser
handshake — and a dev instance sets those handshake cookies `SameSite=None`
without `Secure`, which recent Chromium refuses over plain `http://localhost`.
Driven by hand the flow is fine; under Playwright it is a redirect loop.

Automated browsers sign in with **`clerk.signIn({ page, emailAddress })`** from
`@clerk/testing/playwright` instead, which Clerk supports for exactly this: it
mints a sign-in ticket over the Backend API and redeems it in-page through
`window.Clerk`, with no cross-origin navigation, so the handshake never
happens. It needs `CLERK_SECRET_KEY` in the runner's environment and a
`clerkSetup()` call at start-up to fetch the Testing Token that gets past bot
detection — Testing Tokens work on development instances only. The
`run-finansify` skill's driver wires both up; `login` is the command.

## The Neon branch budget

**Neon's free tier allows 10 branches, and the integration spends them without
asking.** Production holds one and `pre-production` holds another (ADR 0017).
Every preview deployment takes a third, for as long as the git branch it was
built from exists. That leaves **eight** slots shared between everyone's open
work, and the ninth branch does not queue — it fails the deployment, so a PR
that would otherwise be reviewable arrives without a preview.

### Why deleting the git branch is not enough

Two mechanisms already point at this problem and neither solves it, which is
worth knowing before reaching for a third:

- **GitHub's "Automatically delete head branches" is on.** A merged PR removes
  its own head branch, so the remote holds `main` and nothing else. This is
  necessary and does not touch Neon.
- **The Neon-Managed integration reaps preview branches whose git branch is
  gone** — but only _"the next time a preview deployment is created"_. The
  cleanup is lazy and driven by deployment activity, which is exactly the wrong
  trigger: branches accumulate while nothing is deploying, and the deployment
  that would trigger the reap is the one that fails for want of a slot.

So the account fills up during quiet periods and the bill arrives on the next
PR, looking like a broken build.

### What actually keeps the budget

`.github/workflows/neon-cleanup.yml`, on `pull_request: closed` — merged or
abandoned, both end a branch's life. It deletes `preview/<head-ref>` through
`neonctl`, immediately, without waiting for anyone's deployment. It needs
`NEON_API_KEY` (repository secret, project-scoped) and `NEON_PROJECT_ID`
(repository variable — a project id is not a secret).

The job tolerates a missing branch rather than failing on it: a docs-only PR is
skipped by `turbo-ignore` and never gets a database, and a PR closed before its
first deployment finished never got one either. A cleanup job that goes red on
ordinary PRs is a cleanup job nobody reads.

It does **not** cover two cases, which stay manual:

- **Branches created by hand in the console.** Nothing links them to a PR, so
  nothing reaps them. Keep none.
- **Archived branches** — Neon archives a branch after 24 hours idle once it is
  more than 14 days old, and archived branches still count against the ten.

For those, and for a one-off unblocking:

```bash
npx neonctl branches list --project-id <id>
npx neonctl branches delete <branch> --project-id <id>
```

Deleting a preview branch that belongs to an open PR is safe — its next
deployment provisions a fresh one from production. Deleting the default branch
is not, and nothing in this flow ever needs to.

## CI

`ci.yml`, on push to main and on every PR:

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

`neon-cleanup.yml` is the second workflow, on `pull_request: closed` only — see
"The Neon branch budget" above for why it is separate.

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
