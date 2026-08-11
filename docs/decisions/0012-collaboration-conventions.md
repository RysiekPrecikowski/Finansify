# 0012. Repository language, branch protection, and file-minimalism convention

**Status:** Accepted
**Date:** 2026-08-11

## Context

The project has moved from solo scaffolding to active two-person development
(data engineering and backend/Java backgrounds). Three gaps showed up once a
second reviewer entered the loop:

- Nothing said what language the repository itself is written in. The team
  talks to each other and to Claude Code in Polish, but code, docs, and ADRs
  have been English throughout — that needs to be a rule, not an accident,
  before it drifts.
- Nothing stopped a direct push to `main`. With two people touching the same
  ledger and money-handling code, an unreviewed change to `packages/core` or
  a migration is exactly the kind of mistake code review exists to catch.
- Nothing discouraged file sprawl. A hexagonal architecture with explicit
  ports (ADR 0001) is easy to erode one "just one more file" at a time.

## Decision

Three new invariants in `/CLAUDE.md` (rules 11–13):

1. **All technical content is English** — code, identifiers, comments, commit
   messages, PR titles/descriptions, and everything under `docs/`. Spoken and
   chat language stays Polish; nothing that lands in the repository does.
2. **`main` is protected.** Every change lands through a pull request,
   reviewed and explicitly approved by the other teammate, before merge. No
   direct pushes, no force-pushes, no `--no-verify`. (GitHub branch
   protection on `main` enforces the mechanical half of this; the review
   requirement is the human half and is not something branch protection
   alone can guarantee with a two-person team.)
3. **Prefer extending an existing file over adding a new one.** Applies
   review pressure against silently growing the file count instead of
   reusing or refactoring what already exists.

Alongside these, `/CLAUDE.md` gained a "Definition of done" section: `pnpm
check` passing is necessary but not sufficient — the change must actually
have been exercised, money/auth/migration changes get an explicit second
look for data integrity and security, and large or user-facing changes are
described in the PR even when they don't rise to an ADR.

## Consequences

Review now has three more mechanically checkable things to look for, at
near-zero ongoing cost — same trade-off ADR 0002 already made for the
architecture rules.

The branch-protection half needs a one-time GitHub configuration change,
**not yet applied** — the account used by tooling here has `push` but not
`admin` on the repo, so it can't be set via the API. Whoever has admin needs
to do this once, in Settings → Branches → Add branch protection rule for
`main`:

- Require a pull request before merging, ≥1 approval.
- Require status checks to pass before merging — the `check` job from
  `.github/workflows/ci.yml`.
- Do not allow force pushes; do not allow deletions.
- Optionally: include administrators, so the rule has no built-in bypass.

Until that rule exists, rule 12 is enforced by convention and review only,
same as every other rule in this file.

English-only is a one-way door in practice: retrofitting Polish
identifiers or comments later would be a larger, noisier change than just
starting correctly.

## Alternatives considered

**Leave language and branch policy undocumented, rely on habit.** Works
until it doesn't — the whole premise of ADR 0002 is that undocumented
conventions decay silently in a way that documented ones don't.

**Enforce PR-only `main` with a lint rule / CI check instead of a written
rule.** GitHub's branch protection already does the mechanical enforcement;
a CLAUDE.md rule is still needed so the _reason_ ("no direct pushes because
X breaks Y") is legible to whoever is working in the repo, human or agent.
