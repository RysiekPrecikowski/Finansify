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

Then, with the [Vercel CLI](https://vercel.com/docs/cli) installed and this repo linked
(`vercel link`), provision Neon (database) and Clerk (auth) from the Vercel Marketplace:

```bash
vercel integration add neon
vercel integration add clerk
vercel env pull .env.local --yes
```

Each `integration add` may print a one-time browser link to accept that integration's
marketplace terms — accept it, then re-run the command. This provisions
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `CLERK_SECRET_KEY` and
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and pulls them into `.env.local` automatically —
no manual copying from a dashboard, and no renaming, since these are Neon's and Clerk's
own variable names. Both `DATABASE_URL*` values are required and are not
interchangeable — see
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
