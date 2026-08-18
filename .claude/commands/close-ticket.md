---
description: Close out the ClickUp ticket for a PR that has just been merged
argument-hint: [optional: PR number — defaults to the PR for the current branch]
---

Run this right after a PR merges to `main`. It does not merge anything itself
— merging is a separate, manual step; CI green gates it, review is optional
(CLAUDE.md rule 12, ADR 0018). This performs step 5 of `docs/clickup.md`'s
flow — closing the ticket — but only when this PR was the ticket's last one.

**1. Confirm the merge.**

```bash
gh pr view $ARGUMENTS --json state,mergedAt,title,headRefName
```

`state` must be `MERGED`. If it isn't, stop and say so — do not close a ticket
for a PR that only looks finished.

**2. Find the ticket.** Take the id from `headRefName` (`<type>/<slug>-<taskId>`)
or the PR title's trailing `(CU-<taskId>)`. If neither carries an id, stop and
ask which ticket this PR was for rather than guessing.

**3. Read the ticket before writing to it** (`docs/clickup.md`'s "before every
session of work" rule) — `.claude/scripts/clickup.sh GET /v2/task/<taskId>` —
then branch on its status:

- **`in progress`** — this PR was one of several small PRs for the ticket
  (`docs/clickup.md`, "a ticket spanning multiple small PRs") and wasn't the
  last one. Don't close anything: post a comment that this PR merged (step 5,
  reworded accordingly) and stop.
- **`in review`** — this is the ticket's last (or only) PR. Continue to step 4.
- **Anything else** — stop and report the actual status instead of
  overwriting it; something moved it unexpectedly.

For the `in review` case, also read `Implementer` from the response's custom
fields — if it's empty, stop and ask who implemented this rather than guessing
an owner — and note the current `assignees`, which step 4 removes.

**4. Close it.** `.claude/scripts/clickup.sh PUT /v2/task/<taskId>
'{"status":"complete","assignees":{"add":[<implementerId>],"rem":[<currentAssigneeIds>]}}'`
— `Implementer` itself is untouched, only `assignees` moves.

**5. Comment it.** `docs/clickup.md`'s "every status write carries a comment"
rule applies here too — `POST /v2/task/<taskId>/comment` with a one-line note.
For the closing case: that the PR merged and the ticket is closed, plus who
it's now assigned to. For a non-last PR: that this PR merged and the ticket
stays open for the remaining ones. Report which case this was.
