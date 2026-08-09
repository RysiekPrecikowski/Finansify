# Finansify

Ledger-first portfolio tracker for Polish investors. Web only, single user, MVP.

**This file is a router, not a manual.** Read the one doc that matches your task. Do not read all of `docs/`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Drizzle → Supabase Postgres · Supabase Auth · pnpm workspace · Vitest · deployed on Vercel.

## Commands

|                                 |                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                      | run the app                                                                                                |
| `pnpm check`                    | build + lint + typecheck + test + format:check, cached via turbo, same as CI — **run before every commit** |
| `pnpm test` / `pnpm test:watch` | tests                                                                                                      |
| `pnpm db:generate`              | new migration after editing `packages/db/src/schema.ts`                                                    |
| `pnpm db:migrate`               | apply migrations                                                                                           |

## Where code goes

The dependency arrow is one-directional: `apps/web` → `packages/db` → `packages/core`.

| Put it here     | For                                             | Never contains           |
| --------------- | ----------------------------------------------- | ------------------------ |
| `packages/core` | money, FX, ledger rules, valuation, zod schemas | I/O, SQL, React, `fetch` |
| `packages/db`   | Drizzle schema, migrations, queries             | React, business rules    |
| `apps/web`      | routes, server actions, components              | financial calculations   |

ESLint enforces this. **If a boundary rule fires, move the code — never add an `eslint-disable`.**

## Hard rules

1. **Money is `Decimal`, never `number`.** Parse from strings, store as `numeric`, round only at render. `0.1 + 0.2 !== 0.3`.
2. **Every user-owned table gets RLS** plus a `user_id` filter in code. Both. See `packages/db/drizzle/0001_enable_rls.sql`.
3. **Store the FX rate on the transaction.** Never re-derive it later, or historical balances shift when the rate series is corrected.
4. **No background workers, no cron.** Compute on demand and cache the result. See `docs/decisions/0003-lazy-computation.md`.
5. **Missing price or FX data is an error, not an estimate.** Surface the gap; never extrapolate.
6. **Do not upgrade TypeScript past 6.0.x.** `typescript-eslint` peer-requires `<6.1.0`; bumping it silently breaks linting. `deps:update` excludes it deliberately.
7. **Next 16 diverges from what you likely know** (`middleware.ts` is now `proxy.ts`, for one). Working in `apps/web`? Read `apps/web/AGENTS.md` — Next maintains the top block of it, and our web-specific rules sit below.
8. **Intra-package imports are extensionless** (`./money`, not `./money.js`). Turbopack cannot resolve a `.js` specifier to a `.ts` file.

## Which doc to read

| Task                                          | Read                   |
| --------------------------------------------- | ---------------------- |
| What are we building / is X in scope?         | `docs/product.md`      |
| Adding a feature, wiring data                 | `docs/architecture.md` |
| Anything touching money, FX, accounts, ledger | `docs/domain.md`       |
| What's next / current state                   | `docs/roadmap.md`      |
| "Why is it done this way?"                    | `docs/decisions/`      |

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). Branch off `main`, PR in.
- Update `docs/roadmap.md` when you finish a phase item.
- A decision that would be re-argued later goes in `docs/decisions/` as a new numbered ADR. Supersede old ADRs; never rewrite them.
