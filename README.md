# Finansify

Ledger-first portfolio tracker for Polish investors.

Every number is derived from an auditable transaction ledger — including Polish retail
government bonds (TOS, EDO), which most trackers cannot model properly.

**Status:** Phase 0. Foundation only, no product features yet. See [docs/roadmap.md](docs/roadmap.md).

## Setup

Requires Node 22+ and pnpm 10.

```bash
pnpm install
```

Then create a Supabase project (free tier) and copy the credentials:

```bash
cp .env.example .env.local
```

Fill in from the Supabase dashboard:

| Variable                                                    | Where                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API                                                               |
| `DATABASE_URL`                                              | Project Settings → Database → Connection string → **Transaction pooler** (port 6543) |
| `DIRECT_DATABASE_URL`                                       | Same page → **Direct connection** (port 5432)                                        |

Both connection strings are required and are not interchangeable — see
[docs/architecture.md](docs/architecture.md#two-connection-strings-on-purpose).

Apply the schema, then run:

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

## Commands

|                    |                                                                |
| ------------------ | -------------------------------------------------------------- |
| `pnpm dev`         | Run the app at http://localhost:3000                           |
| `pnpm check`       | Lint + typecheck + test. Run before committing                 |
| `pnpm test:watch`  | Tests in watch mode                                            |
| `pnpm db:generate` | Generate a migration after editing `packages/db/src/schema.ts` |
| `pnpm db:migrate`  | Apply migrations                                               |
| `pnpm db:studio`   | Browse the database                                            |

## Layout

```
apps/web         Next.js app — routes, server actions, components
packages/core    Money, FX, ledger rules, valuation. Pure, no I/O
packages/db      Drizzle schema, migrations, queries
docs/            Design docs and decision records
```

Dependencies point one way only: `web → db → core`. ESLint enforces it — if a boundary
rule fires, move the code rather than disabling the rule.

## Docs

Start with [docs/README.md](docs/README.md). Five short files; read the one that matches
what you are doing.

Working with Claude Code: [CLAUDE.md](CLAUDE.md) loads automatically and routes to the
right doc. Shared slash commands live in `.claude/commands/`.

## Notes

- **Do not upgrade TypeScript past 6.0.x.** `typescript-eslint` peer-requires `<6.1.0`; bumping it breaks linting silently. `pnpm deps:update` excludes it on purpose.
- Supabase free projects pause after 7 days without database traffic.
