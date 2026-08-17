---
name: db-migration
description: Generate, review, and land a Drizzle schema change in packages/db. Use when adding or altering a table, column, index, or constraint, or when a migration needs to be checked before merge.
---

The schema lives in `packages/db/src/schema/`, the generated SQL in
`packages/db/migrations/`. Both are committed; neither is written by hand.

Migrations **never run in a build** (CLAUDE.md rule 9). They apply from
`ci.yml`'s `migrate-preproduction` and `migrate-production` jobs, in that
order, after `check` passes on a push to main (ADR 0017).

## Generate

Edit the schema file first — one file per table or tight cluster of tables —
then:

```bash
pnpm --filter @finansify/db db:generate
```

This diffs `src/schema/` against the migrations already on disk and writes a new
`NNNN_<name>.sql` plus its snapshot under `migrations/meta/`. It needs no
database connection.

Commit the generated SQL **in the same commit as the schema change**. A schema
edit without its migration typechecks and tests clean; `check`'s "Schema and
migrations must agree" step is what catches it, by regenerating and failing if
anything appears. Locally that means running `db:generate` yourself rather than
finding out from CI.

## Review before committing

Read the generated SQL — do not assume it. Drizzle infers intent from a diff,
and a rename it cannot see as a rename becomes `DROP COLUMN` + `ADD COLUMN`,
which is data loss that typechecks.

- **Is anything dropped?** A `DROP TABLE` / `DROP COLUMN` on a table holding real
  rows needs a deliberate plan, not a generated statement. For a rename, write
  the `ALTER ... RENAME` by hand instead.
- **Does a new `NOT NULL` column on a populated table have a default?** Without
  one the migration fails against any non-empty database.
- **Is `user_id` present on anything user-scoped?** Nothing global-by-accident:
  `instruments`, `prices`, `fx_rates`, `index_observations`, and
  `bond_series_terms` are the only unscoped tables (`docs/domain.md`).
- **Is money `NUMERIC(28, 10)`?** Never `float8`, never `money` (ADR 0005).
- **Does a foreign key reference our own `users.id` UUID**, never an auth
  provider's subject id (ADR 0009)?

## Make every statement re-runnable

`neon-http` cannot run a multi-statement transaction. A migration that fails
partway leaves the statements that already ran **committed**, and never records
its journal row — so the next run restarts the same file and dies on the object
it just created. The database stays wedged until someone drops the half-created
objects by hand.

Rewrite the generated SQL by hand so that cannot happen. Three substitutions
cover everything drizzle-kit emits:

| Generated                      | Committed as                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `CREATE TYPE ...`              | `DO $$ BEGIN CREATE TYPE ...; EXCEPTION WHEN duplicate_object THEN null; END $$;` |
| `ALTER TYPE ... ADD VALUE 'x'` | `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'x'`                                      |
| `CREATE TABLE ...`             | `CREATE TABLE IF NOT EXISTS ...`                                                  |

Keep the `--> statement-breakpoint` markers exactly where they are; the
migrator splits on them, and a `DO $$` block must sit wholly inside one
statement. `packages/db/migrations/0008_smart_ink.sql` is the worked example.

`ADD VALUE` is the one that actually decides whether an incident is
recoverable. Postgres has no `DROP VALUE`, so once an enum label commits it
cannot be dropped — the usual "drop the objects and re-run" recovery silently
does not cover it, and wedges again one statement later. Each statement is
individually atomic, so `IF NOT EXISTS` never half-creates anything: a
statement either committed or did not run.

This is defence in depth, not the primary guard. The pre-production rehearsal
below is what keeps a broken migration off production in the first place.

## Apply

Nobody applies migrations by hand to production. The path is: PR → review →
merge to main → `check` passes → `migrate-preproduction` → `migrate-production`.
Both run `packages/db/scripts/migrate.ts` via `db:migrate`, differing only in
which secret they pass; `migrate-production` `needs: migrate-preproduction`, so
there is no route to production that skips the rehearsal. Neither triggers on
anything but a `push` to `main` — a fork PR only ever produces a
`pull_request` event, so it cannot reach the connection secrets at all.

The script replaced `drizzle-kit migrate`, which exited 1 with no message and
left a production failure unreadable for three hours. It reports the failing
statement and the driver's own error.

The unpooled connection is not interchangeable with the pooled one the app uses
— the migrator needs a direct session.

To run it against your own database (a Neon branch, never production):

```bash
MIGRATION_TARGET=<branch name> DATABASE_URL_UNPOOLED='<connection string>' \
  pnpm --filter @finansify/db db:migrate
```

`MIGRATION_TARGET` is only a label, but it is the label the failure message
carries — set it, so a broken run says which database it broke.

`vercel env pull --environment=development` hands out the **pre-production**
connection string, which is also the CI gate. Breaking it by hand fails the
next merge's `migrate-preproduction` for a migration that is fine. Reset it
from parent in the Neon console before pushing to `main`; whoever broke it
resets it (`docs/deployment.md`).

## Not yet built

- **Per-PR migration run** — a migration still first meets a real database on
  merge, not on the PR. Preview deployments get their own Neon branch, but
  nothing applies migrations to it; the pre-production rehearsal is what stands
  in, and it runs after merge. Do not write a PR description implying a
  migration was exercised by CI before merge.

The drift check _is_ built — `check`'s "Schema and migrations must agree" step
regenerates and fails if anything appears, so `src/schema/` and `migrations/`
diverging no longer depends on someone noticing.
