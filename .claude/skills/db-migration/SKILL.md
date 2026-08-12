---
name: db-migration
description: Generate, review, and land a Drizzle schema change in packages/db. Use when adding or altering a table, column, index, or constraint, or when a migration needs to be checked before merge.
---

The schema lives in `packages/db/src/schema/`, the generated SQL in
`packages/db/migrations/`. Both are committed; neither is written by hand.

Migrations **never run in a build** (CLAUDE.md rule 9). They apply from
`.github/workflows/migrate.yml` after CI passes on main.

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
edit without its migration passes `pnpm check` and breaks on deploy — nothing
currently detects that drift (`docs/deployment.md` lists the drift check as
still to add).

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

## Apply

Nobody applies migrations by hand to production. The path is: PR → review →
merge to main → `ci.yml` green → `migrate.yml` runs `drizzle-kit migrate` over
`DATABASE_URL_UNPOOLED`.

The unpooled connection is not interchangeable with the pooled one the app uses
— `drizzle-kit migrate` needs a direct session.

To run it against your own database (a Neon branch, never production):

```bash
DATABASE_URL_UNPOOLED='<your branch connection string>' \
  pnpm --filter @finansify/db db:migrate
```

## Not yet built

Both are noted in `docs/deployment.md`; do not write a PR description that
implies either exists.

- **Preview-branch check** — PRs do not yet get their own Neon database branch,
  so a migration first meets a real database on merge, not on the PR.
- **Drift check** — CI does not verify that `src/schema/` and `migrations/`
  agree. Until it does, that check is this document and your own reading.
