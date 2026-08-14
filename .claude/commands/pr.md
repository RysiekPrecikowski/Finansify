---
description: Write a precise, technical PR title and description from the actual diff, then open it
argument-hint: [optional: PR number to update instead of opening a new one]
---

Write the pull request text for this branch against `main`, then open or update
the PR. English only (CLAUDE.md rule 11) — no exceptions for this command.

**1. Read what actually happened, not what you remember deciding.**

```bash
git log main..HEAD --oneline
git diff main...HEAD --stat
```

Read every commit on the branch, not just the latest — a bundled branch is
common here. If the working tree is dirty or `pnpm check` hasn't been run on
this branch yet, stop and say so; run `/ship` first.

**2. Title.** Conventional-commit prefix matching this repo's history
(`feat:`, `fix:`, `chore:`, `docs:`, ...), imperative mood, under 70 characters,
ending with the ClickUp id in parentheses — `feat(web): positions view
(CU-869ej7nzv)`. Take the id from the branch name; if the branch carries no id,
stop and resolve the ticket first (`docs/clickup.md`).

**3. Body.** Four sections, each one either has real content or is omitted —
never pad a section to make it look complete.

- **Summary** — what changed, as fact derived from the diff: which
  files/modules/ports, added/removed/changed. No "this PR adds support for" or
  "various improvements." If someone can't tell what changed from this section
  alone without reading the diff, rewrite it.
- **Impact** — the functional consequence for a user or the other engineer:
  new env var, new migration, changed API shape, changed cache-key shape,
  behavior change in the UI. If genuinely none, write "No behavior change,
  internal only" — do not invent impact to fill the section.
- **Boundary / ADR** — if this moved a boundary (new package, new port,
  swapped provider, changed dependency rule, changed numbered rule in
  `/CLAUDE.md`), name the ADR. If not, write "No boundary change."
- **Test plan** — what was actually run, matching CLAUDE.md's "Definition of
  done": `pnpm check` result, and how the change was exercised (dev server,
  specific test, manual click-through). List only what was actually done.
  Never list an unverified step as if it passed.

**4. Show the draft before sending it.** Then push the branch and run
`gh pr create` (or `gh pr edit $ARGUMENTS` if a PR number was given) with that
title and body. Base is always `main` — CLAUDE.md rule 12 means this PR is how
the change is allowed to reach it at all.

**5. Hand the ticket over.** Once the PR is open: set the ClickUp ticket to
`in review`, clear its assignee (`assignees: []`), leave its `Implementer`
field alone, and comment the PR link on it. An unassigned `in review` ticket is
what "waiting for a reviewer" looks like; `Implementer` is what restores the
assignee at merge — see `docs/clickup.md`. If `Implementer` is empty because
the ticket was started outside this flow, set it to yourself here. Report the
ticket id and its new status in the final line.

**Tone.** This text is read and acted on by the other teammate, which makes it
different from the terse stage-reporting a session emits while working.

- State the fact and its concrete consequence plainly: what changed, what it
  affects, what to check. No hedging ("might want to consider").
- Concrete and kind are not in tension. A short acknowledgment of a good call
  costs nothing and reads better than a flat instruction — but it never
  replaces the specific file, line, or number the other person needs to act.
- No emoji. No filler adjectives ("robust", "powerful", "comprehensive"). No
  padding a section to look complete. Warmer is a register, not an excuse to
  get vaguer.

A reviewer should be able to approve or reject from this text without opening
the diff for anything except the code itself.
