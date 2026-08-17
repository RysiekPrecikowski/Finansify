---
description: Close out the ClickUp ticket for a PR that has just been merged
argument-hint: [optional: PR number — defaults to the PR for the current branch]
---

Run this right after a PR merges to `main`. It does not merge anything itself
— merging stays the manual, reviewed action CLAUDE.md rule 12 requires. This
only performs step 5 of `docs/clickup.md`'s flow: closing the ticket the PR
was for.

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
session of work" rule) — `.claude/scripts/clickup.sh GET /v2/task/<taskId>`.

- If status is not `in review`, stop and report the actual status instead of
  overwriting it — something moved it since `/review` ran.
- Read `Implementer` from the response's custom fields. If it's empty, stop
  and ask who implemented this rather than guessing an owner. Note the current
  `assignees` too — they need removing in step 4.

**4. Close it.** `.claude/scripts/clickup.sh PUT /v2/task/<taskId>
'{"status":"complete","assignees":{"add":[<implementerId>],"rem":[<currentAssigneeIds>]}}'`
— `Implementer` itself is untouched, only `assignees` moves.

**5. Comment it.** `docs/clickup.md`'s "every status write carries a comment"
rule applies here too — `POST /v2/task/<taskId>/comment` with a one-line note
that the PR merged and the ticket is closed. Report the ticket id, its new
status, and who it's now assigned to.
