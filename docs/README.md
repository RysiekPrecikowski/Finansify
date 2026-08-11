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

**None exist yet, deliberately.** A skill describing how to add a `PriceFeed`
adapter, written before `PriceFeed` exists, is a guess — and a procedure
document that has never been executed is the fastest way to teach people that
these files can be ignored. Each skill lands in the phase that creates the code
it describes:

| Skill                 | Lands in | Covers                                                                                       |
| --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `db-migration`        | Phase 0  | generate, review, commit, apply path, preview-branch check, drift check                      |
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

`.claude/commands/` holds one-shots too small to be skills: `/context` loads the
docs relevant to a described task, `/sync-docs` checks that docs and code still
agree, `/ship` runs the pre-PR checklist.
