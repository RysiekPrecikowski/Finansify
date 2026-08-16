# packages/db

The persistence adapter: Drizzle schema, migrations, and the repository
functions that implement `core`'s persistence ports. See `docs/architecture.md`
for the boundary and `docs/decisions/0008-database-engine.md` for why Neon.

## Rules

- Imports `@finansify/core` to use its value objects and to implement its
  ports; never imports `@finansify/providers` or `@finansify/importers`
  (adapters don't import each other — `docs/architecture.md`).
- **Every user-scoped domain query is exposed through a repository bound to a
  user id at construction** — `repository.forUser(userId)`, never a free
  function that takes `userId` as a plain parameter (rule 4, root CLAUDE.md;
  ADR 0009). `users.ts` is the one exception: the identity lookup necessarily
  takes the auth-provider identity rather than a `userId`, since that is how a
  `userId` gets discovered in the first place.
- Schema lives in `src/schema/`, one file per table or tight cluster of tables.
  `src/client.ts` builds the Drizzle instance from a connection string; nothing
  in this package reads `process.env` directly — the caller (`apps/web`'s
  composition root) passes the string in.
- `src/file-store.ts` implements `FileStore` against Vercel Blob — the second
  persistence backend this package holds, alongside Postgres. Same rule as
  `client.ts`: `createFileStore(token)` takes the token as a parameter, never
  reads `BLOB_READ_WRITE_TOKEN` itself.

## Migrations

`pnpm --filter @finansify/db db:generate` after a schema change, reviewed and
committed alongside it. Migrations never run in a build — see
`docs/deployment.md` for the CI flow that applies them.

The `db-migration` skill carries the full procedure, including what to look for
when reading generated SQL.
