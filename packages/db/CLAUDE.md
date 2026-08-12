# packages/db

The persistence adapter: Drizzle schema, migrations, and the repository
functions that implement `core`'s persistence ports. See `docs/architecture.md`
for the boundary and `docs/decisions/0008-database-engine.md` for why Neon.

## Rules

- Imports `@finansify/core` to use its value objects and to implement its
  ports; never imports `@finansify/providers` or `@finansify/importers`
  (adapters don't import each other — `docs/architecture.md`).
- **Every user-scoped query takes a `userId` as an argument.** There is no
  unscoped path (rule 4, ADR 0009).
- Schema lives in `src/schema/`, one file per table or tight cluster of tables.
  `src/client.ts` builds the Drizzle instance from a connection string; nothing
  in this package reads `process.env` directly — the caller (`apps/web`'s
  composition root) passes the string in.

## Migrations

`pnpm --filter @finansify/db db:generate` after a schema change, reviewed and
committed alongside it. Migrations never run in a build — see
`docs/deployment.md` for the CI flow that applies them.

The `db-migration` skill carries the full procedure, including what to look for
when reading generated SQL.
