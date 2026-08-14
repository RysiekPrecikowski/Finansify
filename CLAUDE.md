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
| Tickets, statuses, branch and commit naming                | `docs/clickup.md`      |
| Why something is the way it is                             | `docs/decisions/`      |

## How to work

Applies to every task in this repo, by default, without being asked.

1. **Start from a ticket.** Every change belongs to a ClickUp ticket, and the
   ticket's status and assignee follow the work as it happens — `in progress`
   when you start, `in review` with no assignee when the PR is open,
   `complete` on merge. Branch, commit and PR carry the task id. The whole
   contract, including the board ids, is `docs/clickup.md`; read it before
   starting work, not before finishing it.
2. **Plan before touching anything.** Anything beyond a one-file edit gets a plan
   first — what changes, in which files, in what order, and what verifies it.
   Read the code the plan depends on before writing the plan, not after.
3. **While working, report only the stage.** One short line per stage
   (`Stage 2/4 — schema + migration`), not a narration of each edit, not a
   preview of what you are about to type. The diff is the record; prose about the
   diff is noise.
4. **Final output is short, factual, technical.** What changed, what it verifies
   against, what is left. No summaries of your own reasoning, no restating the
   request, no congratulating the result. Prefer a list of paths and one clause
   each over paragraphs.
5. **Ask only when something genuinely needs a decision** — an ambiguity that
   would send the work in materially different directions, a boundary that needs
   an ADR, a destructive or outward-facing action. Otherwise pick the
   defensible option, state the assumption in one line, and continue. A question
   that has an obvious answer costs more than the answer.

Verification is not optional and not a stage you can report without running:
`pnpm check` before saying anything is done.

## Rules

How `/pr` and `/review` should be written — the register for text the other
teammate reads and acts on — lives in `.claude/commands/pr.md` and
`review.md`, which load exactly when that text is being written.

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
11. **All technical content is English** — code, identifiers, comments, commit
    messages, PR titles and descriptions, and everything under `docs/`. Talk to
    the team in Polish; nothing that lands in the repository is.
12. **`main` is protected.** Every change lands through a pull request,
    reviewed and explicitly approved by the other teammate, before merge. No
    direct pushes, no force-pushes, no `--no-verify`.
13. **Prefer extending an existing file to adding a new one.** A third copy of
    a pattern is a refactor waiting to happen — propose the refactor instead of
    writing the copy.
14. **Finishing work means ticking its box.** If a change completes something
    tracked in `docs/roadmap.md` — a "Where we are" item or a Feature-backlog
    entry — tick that checkbox in the same commit. Never tick one for work that
    is merely planned or partially done; a box that overstates reality is worse
    than an unticked one. If the work isn't tracked there and should be, add the
    line, then tick it.
15. **One pull request, one change.** A PR carries a single reviewable
    intention — one feature, one fix, one refactor. Unrelated work goes to its
    own branch even when it is one line and even when you are already in the
    file. A reviewer who opened "chart animation" should never find a change to
    transaction encryption. Prefer several small PRs over one that needs a
    table of contents; the description says what changed and why in a few
    paragraphs, not an essay.
16. **Nobody writes both an implementation and its tests.** Whoever wrote the
    code cannot be the one who tests it — hand it to the other teammate or to a
    separate agent, given the source and the spec but not the author's
    reasoning. An author tests what they meant; a second reader tests what is
    there. This is not process for its own sake: it is how the `decimal.js`
    precision bug in `matchLots` was found, and it would not have been found
    otherwise.
17. **`packages/core` is written test-first.** Its behaviour is specified
    before it exists — FIFO by Polish tax treatment, cost basis by
    `docs/domain.md`, the bond engine by published interest tables — so the
    test is a transcription, not a guess. Write the test file, then implement
    against it; handing that file to an agent as the contract removes anything
    for it to interpret. Adapters and UI are the other way round: their shape
    is discovered, so tests follow the code.
18. **Every database branch is owned by a pull request.** Neon's free tier
    gives ten branches, production holds one, and each open PR's preview holds
    another — so a branch that no PR accounts for is a slot nobody can reclaim,
    and the eleventh PR gets no preview at all. Closing a PR deletes its branch,
    automatically and eagerly, via `.github/workflows/neon-cleanup.yml`; do not
    rely on the integration's own reap, which only runs when the next preview
    deploys. Never create a Neon branch by hand in the console — a branch with
    no PR behind it has nothing that will ever clean it up.
    (`docs/deployment.md`, "The Neon branch budget")

## When you change a boundary

A new package, a new port, a swapped provider, or a change to any rule above
needs an ADR in the same change. See `docs/decisions/README.md`.

Docs and code ship together. If a change makes a document wrong, fix the
document in the same commit — a stale rule is worse than no rule, because it
teaches everyone that this file can be ignored.

## Definition of done

`pnpm check` green is necessary, not sufficient.

- **Exercise the change** before calling it done — run the dev server or the
  relevant test, per the phase's checklist in `docs/roadmap.md`'s
  "Verification" section. A green CI run is not a substitute for having
  actually run the thing that changed.
- **Money, auth, and migrations get a second look** for data integrity and
  security, not just correctness. Run `/security-review` for anything
  touching auth, money movement, or user data — **before the PR is merged, not
  after**. A review that runs once the code is on `main` finds the same things
  and fixes them in a second PR, which is how a finding gets deferred instead
  of fixed.
- **A large or user-facing change is described in the PR**, even one that
  isn't a boundary change and doesn't need an ADR.

## Team & efficiency

Two of us, data engineering and backend/Java backgrounds — technical language
is fine, do not simplify explanations. This repo runs behind `rtk`: read the
one doc that matches the task (table above), not all of `docs/`; prefer
targeted reads and greps over dumping whole files; batch independent tool
calls; reach for a subagent instead of many serial searches on open-ended
exploration.

## Commands

| Command           | Does                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Run the app                                                      |
| `pnpm check`      | build + lint + typecheck + test + format — run before committing |
| `pnpm test:watch` | Tests in watch mode                                              |

## Environment

Node 24+, pnpm 10. Do not upgrade TypeScript past 6.0.x — `typescript-eslint`
peer-requires `<6.1.0`, which is why `deps:update` excludes it.
