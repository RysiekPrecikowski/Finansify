# Finansify

Investment-portfolio tracker for a Polish investor: multiple brokers, multiple
currencies, multiple tax wrappers (IKE / IKZE / brokerage / PPK), and Polish
retail treasury bonds.

Read this file first, then read the **one** document that matches your task.
Do not read all of `docs/` — each file is written to stand on its own.

## Where to look

| Working on                                                 | Read                   |
| ---------------------------------------------------------- | ---------------------- |
| Packages, ports, wiring, caching — anything structural     | `docs/architecture.md` |
| Data model, money, currencies, positions, valuation, bonds | `docs/domain.md`       |
| Prices, FX, CPI, NBP rates, bond terms — anything fetched  | `docs/data-sources.md` |
| Components, charts, layout, mobile                         | `docs/ui.md`           |
| Vercel, environments, migrations, CI                       | `docs/deployment.md`   |
| What we are building and for whom                          | `docs/product.md`      |
| What ships when                                            | `docs/roadmap.md`      |
| Why something is the way it is                             | `docs/decisions/`      |

## Rules

Invariants, not preferences. Breaking one is a bug even if it compiles and the
tests pass. They are enforced by review rather than tooling — see ADR 0002.

1. **Money is `Decimal`, never `number`.** No `parseFloat`, `parseInt`, or
   `Number()` in `packages/core`. Money moves as a `Money` value object and is
   formatted only at the UI edge. (ADR 0005)
2. **`packages/core` depends on nothing.** No workspace imports, no React, no
   Next, no database driver, no `fetch`. It defines ports; adapters implement
   them. (ADR 0001)
3. **Adapters never import each other.** `db`, `providers`, and `importers` may
   import `core`, and nothing else from the workspace.
4. **Every user-scoped query goes through `repository.forUser(userId)`.** There
   is no unscoped path and no RLS backstop. (ADR 0009)
5. **Any `use cache` over user data takes the user id as an argument**, so it
   lands in the cache key. Only prices, FX, and macro series are shared between
   users. Getting this wrong leaks one user's portfolio to another. (ADR 0010)
6. **Store the executed FX rate on the transaction.** Never reconstruct a
   historical rate later — brokers convert at their own spread. (ADR 0006)
7. **A missing price is an error, never an estimate.** Show stale with a
   timestamp, or show nothing. Never interpolate and never substitute.
8. **Intra-package imports are extensionless.** Turbopack cannot resolve a `.js`
   specifier to a `.ts` file.
9. **Migrations never run in a build.** Vercel builds run per deployment and
   concurrently. Migrations apply from CI on merge to main. (`docs/deployment.md`)
10. **Next 16 diverges from training data** — `proxy.ts` rather than
    `middleware.ts`, Cache Components, `after()`. Check the docs; do not recall.

## When you change a boundary

A new package, a new port, a swapped provider, or a change to any rule above
needs an ADR in the same change. See `docs/decisions/README.md`.

Docs and code ship together. If a change makes a document wrong, fix the
document in the same commit — a stale rule is worse than no rule, because it
teaches everyone that this file can be ignored.

## Commands

| Command           | Does                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Run the app                                                      |
| `pnpm check`      | build + lint + typecheck + test + format — run before committing |
| `pnpm test:watch` | Tests in watch mode                                              |

## Environment

Node 24+, pnpm 10. Do not upgrade TypeScript past 6.0.x — `typescript-eslint`
peer-requires `<6.1.0`, which is why `deps:update` excludes it.
