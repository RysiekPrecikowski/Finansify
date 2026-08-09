# 0002 — Three packages, no build step

**Status:** Accepted
**Date:** 2026-08-10

## Context

The previous iteration of this repo had nine packages and two apps for a product with
zero features. Five of them held under thirty lines of unused type declarations. Each ran
a `tsup` build producing a `dist/` that nothing imported — every package's `exports`
pointed at `src/` — so every CI run built nine dead artifacts.

The justification for the split was sharing code with a future mobile client. Nothing
schedules a mobile client.

The opposite extreme — a single Next.js app with everything in `src/lib` — was considered
and rejected for a specific reason: with two developers and coding agents writing much of
the code, _directory_ conventions get eroded quickly, and by the time you notice, the
dependency graph is untraceable. A package boundary is checkable; a directory convention is a hope.

## Decision

Three packages, with a strictly one-directional dependency arrow:

```
apps/web  ->  packages/db  ->  packages/core
```

- `core` — money, FX, ledger rules, valuation, zod schemas. **Zero I/O, zero framework.**
- `db` — Drizzle schema, migrations, queries.
- `web` — Next.js app.

Two supporting choices:

1. **Boundaries are enforced by ESLint** (`no-restricted-imports` in `eslint.config.mjs`), with error messages that say where the code belongs. Not a convention — a build failure.
2. **Packages export TypeScript source, not build output.** Next transpiles them via `transpilePackages`. No `tsup`, no `dist/`, no build ordering, no orchestrator.

Dropping the build step is what removes the need for Turborepo. `pnpm` runs the workspace on its own.

## Alternatives

| Option                       | Why not                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Single app, `src/lib/domain` | No enforceable boundary. Fine for one careful developer; not for two plus agents |
| Keep nine packages           | Ceremony with no consumer. Nothing was shared with anything                      |
| Turborepo with build outputs | Caching solves a problem we no longer have once packages ship source             |

## Consequences

- `core` cannot be published to npm as-is (it ships `.ts`). Irrelevant — it is private, and adding a build later is mechanical.
- Consumers must be listed in `transpilePackages`. A fourth package means one more line.
- Intra-package imports must be **extensionless** (`./money`, not `./money.js`), because `moduleResolution: Bundler` resolves TS source directly and Turbopack cannot follow a `.js` specifier to a `.ts` file.
- Splitting `core` further later is cheap; the boundary already exists.

## Revisit when

- A second consumer of `core` actually exists (mobile app, CLI, separate API service).
- A package genuinely needs to be published or consumed as compiled output.
