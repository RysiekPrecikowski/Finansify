# Documentation

Four kinds of writing, four homes. Putting a thing in the wrong place is how
documentation rots, so the split is deliberate:

| Kind           | Home              | Contains                                                               |
| -------------- | ----------------- | ---------------------------------------------------------------------- |
| **Invariants** | `/CLAUDE.md`      | Rules that must never be broken. Short, imperative, checkable.         |
| **Knowledge**  | `docs/*.md`       | How the system works. The actual explanation.                          |
| **Decisions**  | `docs/decisions/` | Why it works that way. One decision per file, immutable once accepted. |
| **Procedures** | `.claude/skills/` | Repeatable multi-step tasks, loaded on demand. See below.              |

`CLAUDE.md` links here and never duplicates. When a document and `CLAUDE.md`
disagree, the document is the detail and `CLAUDE.md` is the rule — if they
actually contradict, one of them is a bug.

## The documents

| File              | Covers                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| `product.md`      | What Finansify is, who uses it, what it must answer                             |
| `architecture.md` | Packages, the dependency rule, ports, composition root, caching layers          |
| `domain.md`       | Data model, the ledger, money, currencies, positions, valuation, bonds          |
| `data-sources.md` | Every external feed, what it actually offers, and how we degrade when it breaks |
| `ui.md`           | Component stack, charting, visual direction, mobile                             |
| `deployment.md`   | Vercel setup, environments, migrations, CI                                      |
| `roadmap.md`      | Build order, verification strategy, open questions                              |
| `decisions/`      | ADRs                                                                            |

## Skills

Project skills live in `.claude/skills/<name>/SKILL.md` and load on demand, so
they carry procedure without costing context on every task.

**`run-finansify`** builds, launches, and drives `apps/web`: start the dev
server, then a headless-Chromium driver (`driver.mjs` — this environment has
no `chromium-cli`) navigates it and takes real screenshots, desktop and at
iPhone-13-mini width. Use it whenever a change needs to be _seen_ rather than
just typechecked — CLAUDE.md's Definition of done requires the change to be
exercised, and this is what makes that possible without a human opening a
browser.

**`db-migration`** covers a Drizzle schema change end to end: generate the
migration, what to look for when reading the generated SQL (a rename Drizzle
can't see becomes `DROP` + `ADD`), and the apply path through
`.github/workflows/migrate.yml`. It also names the two things that are _not_
built yet — the preview-branch check and the drift check — so nobody writes a
PR description implying they ran.

The domain-code skills below **don't exist yet, deliberately.** A skill
describing how to add a `PriceFeed` adapter, written before `PriceFeed`
exists, is a guess — and a procedure document that has never been executed is
the fastest way to teach people that these files can be ignored. Each lands in
the phase that creates the code it describes:

| Skill                 | Lands in | Covers                                                                                       |
| --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `add-price-provider`  | Phase 2  | Implementing `PriceFeed`: adapter, identifier mapping, TTLs, market calendar, fallback order |
| `add-bond-family`     | Phase 3  | Family rules entry, resolver expectations, golden test against published tables              |
| `add-broker-importer` | Phase 4  | New `StatementParser`: sniffing, column mapping, dedup, staging, review UI                   |

Skills describe _how we do it here_. They never restate domain knowledge that
belongs in `docs/` — when a skill and a document disagree, the document wins and
the skill is the bug.

`.claude/skills/` holds two unrelated things: symlinks to vendor reference docs
installed by `vercel integration add`, and our own project skills. `.gitignore`
splits them by shape — everything under the directory is excluded, then real
directories are re-included, which catches project skills while leaving the
vendored symlinks out. So writing `.claude/skills/<name>/SKILL.md` is all that is
needed; no `.gitignore` edit per skill.

## Slash commands

`.claude/commands/` holds one-shots too small to be skills — instructions
followed when you type `/name`, not code that runs on its own:

| Command           | Does                                                                                                                                 | Use it when                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `/context <task>` | Loads only the docs relevant to a described task                                                                                     | Starting work, so unrelated docs don't waste context |
| `/sync-docs`      | Checks that `docs/` still matches the code                                                                                           | After a change that might have made a doc stale      |
| `/ship`           | Runs `pnpm check`, checks the boundary rules by hand (nothing lints them), reports readiness                                         | Before opening a PR                                  |
| `/pr`             | Writes the PR title/description from the actual diff and commit log, then opens it                                                   | Once `/ship` is clean and the PR text needs writing  |
| `/review`         | Checks a diff/branch/PR against this repo's own rules — money/Decimal, package boundaries, ADRs — that a generic reviewer can't know | Before merge, alongside `/code-review`               |
