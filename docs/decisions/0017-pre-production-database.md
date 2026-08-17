# 0017. Migrations rehearse on a pre-production branch

**Status:** Proposed
**Date:** 2026-08-16

## Context

Until now a migration's first contact with a production-shaped database was
production itself. `main` merged, CI ran `db:migrate` against the production
branch, and whatever happened, happened.

On 2026-08-16 that produced a three-hour outage of the migration pipeline. The
`check` job stayed green, so five further merges landed on a database that was
no longer being migrated, and nobody looked at the `migrate` job because
nothing else was red.

Two properties of the setup turned one bad migration into a wedge:

**`neon-http` cannot run a multi-statement transaction.** A migration that
fails partway leaves the statements that already ran committed, and never
records its journal row. The next run restarts the same file and dies on its
first `CREATE TYPE`. Recovery means dropping half-created objects by hand
against live data.

**`drizzle-kit migrate` exits 1 with no message.** The CI log carried the exit
code and nothing else — no failing statement, no driver error. Diagnosis
required reproducing the failure locally against a database in the same state.

The preview branches the Neon integration creates per pull request do not help:
they are created from production's _schema at branch time_, they are destroyed
when the PR closes, and no migration runs against them in the merge path.
Nothing rehearses the exact sequence that production will run.

## Decision

A **persistent `pre-production` Neon branch**, and migrations run against it
first.

CI's single `migrate` job becomes two: `migrate-preproduction`, then
`migrate-production` gated on it with `needs`. Production is only touched once
the identical migration set has applied cleanly to a branch carrying
production's schema and journal state.

`db:migrate` moves from `drizzle-kit migrate` to `packages/db/scripts/migrate.ts`,
which prints the failing statement and the driver's own error. A gate that
fails illegibly is barely a gate; the incident above was diagnosable in minutes
once the cause was visible.

`pre-production` is also what local development points at. `vercel env pull
--environment=development` hands out its connection string, so a hand-run
`db:migrate` lands somewhere that is checked rather than on a branch nobody
looks at again.

**One branch serves both roles, and they conflict.** It is the CI gate and the
place someone breaks things by hand on a Tuesday. A branch left broken makes
`migrate-preproduction` fail on Wednesday for a migration that is perfectly
correct, and the failure will be read as a bad migration rather than as
yesterday's mess.

The convention that resolves it: **reset from parent before pushing anything to
`main`.** Whoever broke it resets it. A second branch would remove the need for
the convention and cost another slot out of ten — declined at two people, where
the convention is cheaper than the slot. Revisit when the team is larger or when
a stale `pre-production` has actually blocked a merge, because that is the
signal the trade has stopped paying.

## Consequences

**A failed migration is now discovered on a copy.** The wedge still happens —
this does not make `neon-http` transactional — but it happens to a branch that
can be reset from its parent in one action, with no live data and no time
pressure, and production stays on its last good schema.

**Rule 18's branch budget tightens by one.** Neon's free tier gives ten
branches; production holds one, `pre-production` now holds another, leaving
eight for concurrent preview deployments rather than nine. That is a real cost
and the eleventh open PR now becomes the ninth.

**Rule 18's prohibition needs a carve-out.** It says never create a Neon branch
by hand, because a branch with no PR behind it has nothing that will ever clean
it up. `pre-production` is deliberately exactly that: long-lived, owned by no
PR, and never reaped. The rule's reasoning is intact — an _accidental_ orphan is
still a leak — so the rule now names this one exception rather than being
silently violated by it.

**`pre-production` drifts and must be reset.** It accumulates whatever
migrations and data the team runs at it, deliberately — it is also the local
sandbox. Reset from production ("reset from parent" in Neon) whenever the
rehearsal stops resembling the real thing, and always before pushing to `main`
after breaking it by hand. A migration that passes against a drifted branch
proves nothing about production, which is the failure mode this whole ADR is
about; a gate that lies is worse than no gate.

**Merges are slower by one migration run.** Roughly a minute. Cheap against the
alternative measured today.

## Alternatives considered

**Wrap migrations in a transaction so a failure rolls back.** The correct fix,
and unavailable: `neon-http` is a stateless HTTP driver with no interactive
transaction. It would mean a second driver (`@neondatabase/serverless`'s
WebSocket pool, or node-postgres) used only by the migration path — a second
connection mechanism to keep working, for a job that runs a few times a week.
Worth revisiting if drizzle's neon-http migrator ever grows a transactional
mode; the pre-production branch is useful regardless, because a rolled-back
migration still tells you nothing until it has run somewhere.

**Rely on the per-PR preview branches.** They already exist and cost nothing
extra. Rejected: they are branched from production's schema before the
migration exists, they die with the PR, and nothing runs the merge-path
migration against them. They test the application, not the migration.

**Run migrations manually after inspecting them.** Rejected for the reason
`docs/deployment.md` gives for automating them at all — a manual step is skipped
under time pressure, which is exactly when it matters.

**Do nothing and rely on review.** The migration that broke this was reviewed
and approved. Review catches a wrong column; it does not catch a driver that
cannot roll back.
