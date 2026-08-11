---
description: Review a diff, branch, or PR against Finansify's own invariants — boundaries, money, caching, conventions
argument-hint: [optional: PR number or branch — defaults to the current diff against main]
---

Review **$ARGUMENTS** (empty means: the current working diff, or `main...HEAD`
if the tree is clean) against this repo's own rules. This is not a general
correctness/style pass — that's `/code-review`. This command exists because
generic review has no way to know these rules; it only catches what a reviewer
who has read `/CLAUDE.md` would catch.

**1. Get the real diff.**

```bash
gh pr diff $ARGUMENTS        # if $ARGUMENTS is a PR number
git diff main...<branch>     # if $ARGUMENTS is a branch
git diff                     # otherwise, working tree
```

**2. Read `/CLAUDE.md` in full**, plus `packages/core/CLAUDE.md` and
`apps/web/AGENTS.md` if the diff touches those trees.

**3. Walk every changed hunk against this checklist.** Don't skim — a
violation is often a single import line or one raw number:

- **Money** — any `parseFloat`, `parseInt`, or `Number()` inside
  `packages/core`? Money handled as `Money`/`Decimal` everywhere it moves?
- **Core purity** — anything in `packages/core` importing another workspace
  package, React, Next, a DB driver, or calling `fetch`?
- **Adapter isolation** — `db`, `providers`, `importers` importing each other?
- **User scoping** — every user-scoped query going through
  `repository.forUser(userId)`? Any unscoped path?
- **Cache keys** — every `use cache` over user data taking the user id as an
  argument? Anything shared globally that shouldn't be (or vice versa)?
- **FX rate** — is an executed FX rate stored on the transaction, or is a
  historical rate being reconstructed after the fact?
- **Missing prices** — is a missing/stale price ever estimated, interpolated,
  or substituted, instead of shown as stale-with-timestamp or not shown?
- **Imports** — intra-package imports extensionless?
- **Migrations** — anything running a migration from a build step rather than
  CI-on-merge?
- **Next 16** — `proxy.ts` not `middleware.ts`; Cache Components used
  correctly; nothing that looks like a `middleware.ts`-era pattern copied from
  training data.
- **Language** — any Polish (or other non-English) in code, identifiers,
  comments, or the commit/PR text itself?
- **File count** — a new file where extending an existing one would have done?
  A third near-duplicate of an existing pattern?
- **Boundary + ADR** — does this diff move a boundary (new package, new port,
  swapped provider, changed dependency rule, changed numbered CLAUDE.md rule)?
  If so, is there an ADR in the same diff? Its number, and does its content
  actually match what the code does?
- **UI conventions** (`apps/web/AGENTS.md`, only if UI changed) — green/red
  used only for P&L? Tables going through `<DataList>` rather than a hand
  rolled responsive table? Stale data labeled with its timestamp? An
  unvaluable position shown as such rather than dropped?
- **Security & data integrity** — does this touch auth, money movement, or a
  migration? If so, flag that `/security-review` should run before merge if it
  hasn't.
- **Docs** — does anything in the diff make a doc in `docs/` wrong? If yes,
  say which document and suggest running `/sync-docs`.

**4. Report with `ReportFindings`.** One finding per violation, file and line,
most severe first (a money-as-float or a cross-user cache leak outranks a
missing extensionless import). If a hunk is fine, do not invent a finding to
have something to say — an empty list is a valid, correct result.

Do not silently fix anything. This command reviews; `/code-review --fix` or a
human applies the fix.
