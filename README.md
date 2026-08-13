# finansify

An investment-portfolio tracker for a Polish investor: multiple brokers, multiple
currencies, multiple tax wrappers (IKE / IKZE / brokerage / PPK), and Polish
retail treasury bonds.

It answers four questions — what do I own, what is it worth right now, where did
the return come from, and how does that compare to just buying the market.

> **Status: design complete, implementation not started.** The repository holds
> the documentation and decisions the build will follow. See
> [`docs/roadmap.md`](docs/roadmap.md) for what ships when.

## Documentation

Start with [`CLAUDE.md`](CLAUDE.md) — it routes to the one document that matches
what you are doing, and lists the invariants that hold across all of them.

| Document                                       | Covers                                              |
| ---------------------------------------------- | --------------------------------------------------- |
| [`docs/product.md`](docs/product.md)           | What this is and who it is for                      |
| [`docs/architecture.md`](docs/architecture.md) | Packages, ports, the dependency rule, caching       |
| [`docs/domain.md`](docs/domain.md)             | Data model, money, currencies, valuation, bonds     |
| [`docs/data-sources.md`](docs/data-sources.md) | Market data, FX, and the Polish public-data problem |
| [`docs/ui.md`](docs/ui.md)                     | Component stack, charts, visual direction, mobile   |
| [`docs/deployment.md`](docs/deployment.md)     | Vercel, environments, migrations, CI                |
| [`docs/roadmap.md`](docs/roadmap.md)           | Build order, verification, open questions           |
| [`docs/decisions/`](docs/decisions/)           | ADRs — why things are the way they are              |

[`docs/README.md`](docs/README.md) explains how the docs are organized, and
lists the `/slash-commands` and AI-agent skills available under `.claude/` —
including `run-finansify`, which builds, launches, and drives the app
headlessly (real screenshots, no human needed to check that a UI change
actually renders).

## Layout

```
apps/web        Next.js app (App Router, Tailwind v4) and composition root
packages/core   Domain: calculations and port interfaces. Depends on nothing.
```

`packages/db`, `packages/providers`, and `packages/importers` arrive in Phase 0.

## Setup

Requires Node 24+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Signing in locally

Clerk sign-up is **restricted** (ADR 0009) — there is no public self-serve path,
so `/sign-up` alone will not get you in. Use the shared test account instead:

```bash
vercel env pull
```

`.env.local` will then contain `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` alongside
the Clerk keys. Sign in with those at `/sign-in`. See
[`docs/deployment.md`](docs/deployment.md#test-user) for how that account is
provisioned and who to ask if the credentials stop working.

For browser automation (an agent, a screenshot check) that can't type a
password into a form, visit `/api/dev/test-login` instead — it signs the
browser in as the test account directly.

## Commands

|                   |                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`        | Run the app                                                                        |
| `pnpm check`      | build + lint + typecheck + test + format, cached via Turbo — run before committing |
| `pnpm test`       | Run tests                                                                          |
| `pnpm test:watch` | Tests in watch mode                                                                |
