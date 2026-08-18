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
`gh pr create --draft` (or, if a PR number was given and it isn't already a
draft, `gh pr edit $ARGUMENTS` for the text plus `gh pr ready $ARGUMENTS
--undo` to put it back into draft) with that title and body. Base is always
`main` — CLAUDE.md rule 12 means this PR is how the change is allowed to reach
it at all.

A PR opens as a draft by default and stays one through the rest of this
command. Draft is the "not yet ready for a human to spend time on this"
signal — CI can still run against it, but nobody should be reading it as a
finished change. Nothing in the following steps takes it out of draft on its
own.

**5. Wait for CI.** Run `gh pr checks --watch`. If a check fails, stop and
report it — the PR stays draft and the ticket stays untouched.

**6. Once CI is green and the change has actually been exercised** (dev
server, the relevant test, a manual click-through — CLAUDE.md's Definition of
done, not just a green pipeline), **propose** marking the PR ready for review.
Do not run `gh pr ready` yourself — this is an outward-facing, visible action
(the PR starts existing for a reviewer) and belongs with the person who owns
that judgment call. State what you tested and how, and wait for either an
explicit go-ahead or the user doing it themselves on GitHub.

**7. Hand off the ticket — only for its last planned PR.** If more small PRs
are still planned for this ticket (`docs/clickup.md`, "a ticket spanning
multiple small PRs"), this step doesn't apply once the PR is out of draft:
just post the PR link as a comment (4 below) and stop — status and assignee
stay as they are. Not sure whether more are coming? Ask.

For the last (or only) PR, once it's out of draft — by your `gh pr ready`
after confirmation, or because the user already did it — run
`docs/clickup.md`'s flow step 3 via `.claude/scripts/clickup.sh` (full
endpoint reference there):

1. `GET /v2/task/<taskId>` to read current `assignees` and `Implementer`.
2. `PUT /v2/task/<taskId>` with
   `{"status":"in review","assignees":{"add":[],"rem":[<currentAssigneeIds>]}}`.
   `Implementer` stays untouched.
3. If `Implementer` came back empty (ticket started outside this flow), set it
   to yourself: `POST /v2/task/<taskId>/field/4aaf7617-f6d2-4b03-aa0c-2e30d7e3294d`
   with `{"value":{"add":[<yourId>],"rem":[]}}`.
4. `POST /v2/task/<taskId>/comment` with a short summary of what was actually
   done, the new status (if it changed), and who it's assigned to (or not)
   now, plus the PR link (`docs/clickup.md`, "every status write carries a
   comment").

Report the ticket id and what happened to it. If this was a non-last PR, say
that the ticket was left as-is with the PR link posted. If the PR is still
draft when this command ends (proposal not yet confirmed), say that instead —
the ticket stays wherever it already was.

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
