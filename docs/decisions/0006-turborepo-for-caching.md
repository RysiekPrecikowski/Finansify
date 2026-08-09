# 0006 — Turborepo for task orchestration and caching

**Status:** Accepted
**Date:** 2026-08-10

## Context

ADR [0002](0002-three-package-workspace.md) removed Turborepo along with the nine-package
split, because its main job at the time — ordering and caching `tsup` builds across nine
packages that produced dead `dist/` output — no longer existed once packages started
shipping TypeScript source directly.

That conflated two different things: Turborepo as a _build-output_ tool, and Turborepo as
a _task cache_. The second still has a real, low-cost use: `typecheck` and `build` are
genuinely per-package tasks, and the project deploys on Vercel, which gives Turborepo free
remote caching with no extra infrastructure.

## Decision

All five checks — `build`, `typecheck`, `lint`, `test`, `format:check` — run through
`turbo run`, via `pnpm check`. `lint`, `test` and `format:check` are wired as **root
tasks** (`//#lint`, `//#test`, `//#format:check` in `turbo.json`) rather than per-package
scripts: all three already run once across the whole repo in a single process (one ESLint
flat config, one Vitest config, one Prettier invocation), so there is nothing per-package
to split. A root task lets turbo cache that single global command without inventing a
duplicate script for every package.

`pnpm lint`, `pnpm test` and `pnpm format:check` still exist as plain direct commands
(`eslint .`, `vitest run`, `prettier --check .`) for fast local iteration without cache
log-replay — and because they **must**: a root task's underlying command is that same
root package.json script, so if `pnpm lint` were itself `turbo run lint`, invoking it
would recurse into itself.

CI runs `pnpm check` as a single step rather than mirroring it as separate steps per
tool — one command to keep in sync with the local pre-commit gate, and turbo's own output
prefixes each task and names the failing one clearly on error.

`format:check` was added after the first version of this ADR shipped: it existed as a
script (`prettier --check .`) but nothing actually invoked it, in `pnpm check` or in CI —
so unformatted code could merge clean despite `.prettierrc.json` being configured. Found by
asking "are we actually running this?" rather than assuming a defined script means an
enforced one.

No package gained a build script it didn't already have. `core` and `db` still export
`./src/index.ts` directly — turbo does not reintroduce `dist/` output.

### The `transit` task exists to prevent a real bug

Turborepo does **not** automatically include a workspace dependency's current source in a
downstream per-package task's cache key — that only happens for tasks explicitly wired
together via `dependsOn`. This was verified the hard way: an initial version of this setup
had `typecheck` with no `dependsOn`, and testing it by hand — editing
`packages/core/src/money.ts` and rerunning `pnpm check` — showed `packages/db:typecheck`
and `apps/web:typecheck` both reporting a **cache hit** on the stale result. A developer
could break `core`, get a green check, and ship it.

Every package now has a no-op `"transit": "exit 0"` script, and:

```json
"transit": { "dependsOn": ["^transit"] },
"typecheck": { "dependsOn": ["transit"] },
"build": { "dependsOn": ["^build", "transit"] }
```

`transit`'s only job is to create a task-graph edge to every internal dependency, so its
own hash — and anything that depends on it — transitively includes their current source.
`typecheck` and `build` depend on it for exactly that reason. `lint`/`test` don't need it:
being root-scoped, they were confirmed by the same test to already hash the whole repo.

Notably, this `transit` pattern existed in the _original_ version of this repo's
`turbo.json`, before the rewrite that produced ADR 0002 deleted it as apparent ceremony.
It wasn't ceremony — it was solving this exact problem. Worth remembering next time
something in an inherited config looks unnecessary without a documented reason.

## Alternatives

| Option                                                                 | Why not                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Per-package `lint`/`test`/`format:check` scripts instead of root tasks | Same caching outcome, but duplicates a global command into every `package.json`                                             |
| No `transit` task, rely on default hashing                             | Verified incorrect by hand — silently caches a stale, broken result across the dependency graph                             |
| Keep plain `pnpm -r` / `pnpm --filter`, no turbo                       | Forgoes free Vercel remote caching and correct incremental caching as the workspace grows, for no benefit                   |
| Keep CI as separate steps per tool                                     | Clearer per-step pass/fail icons in the GitHub UI, at the cost of a second place the check list can drift from `pnpm check` |

## Consequences

- One more devDependency, plus a one-line no-op `transit` script in every package — the cost of guaranteeing correct cache invalidation across the internal dependency graph.
- `.turbo/` in `.gitignore`.
- Remote caching (`npx turbo login && npx turbo link`) is not yet configured — it's a one-time, account-linked action for whoever sets up the Vercel project, not something to script.
- At current workspace size the raw speed win is small (a cold `pnpm check` takes ~5s); the value today is mainly the verified-correct invalidation, with the caching payoff growing as the workspace does.

## Revisit when

`lint` or `test` stop being single fast global commands — e.g. if a package gains its own
genuinely independent lint/test configuration worth caching separately (at which point it
should get a real per-package script, and the `transit` dependency treatment above).
