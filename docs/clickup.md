# ClickUp — tickets, statuses, and how git names things

Work is tracked in ClickUp. This document is the whole contract: which board,
which statuses, who is assigned when, and how a branch, a commit and a PR have
to be named so the GitHub integration links them back to the ticket.

Read this before starting any piece of work, not after finishing it.

## Setup

Each of us calls the ClickUp API v2 directly with our own personal API token —
not the OAuth connector, and not a project `.mcp.json`. ClickUp rate-limits
per token (Free/Unlimited/Business: 100 requests/minute), so a shared or
proxied token means one person's usage throttles the other; a personal token
keeps the buckets separate.

Generate yours at ClickUp → Settings → Apps → API Token, and save it to
`~/.config/clickup/token` (`chmod 600`, outside the repo — this project's
GitHub is public). All calls go through `.claude/scripts/clickup.sh`:

```bash
.claude/scripts/clickup.sh METHOD /v2/path '{"json":"body"}'
```

It reads the token from that file, never echoes it, and enforces the rate
limit itself: on a `429` it records the reset time and refuses every call
until that time passes, printing `RETRY_AFTER=<seconds>` on stderr instead of
hammering an already-throttled token. If a call is refused this way, wait for
`RETRY_AFTER` (or retry automatically once it elapses) rather than retrying
immediately — the connector-based throttling this replaced came from ignoring
exactly that signal.

Because the token is personal, `me` does not resolve automatically the way it
did through the connector — use the numeric id from Members, below. `/pr` and
`/review` depend on this script for steps 3 and 4 of the flow; if the token
file is missing, stop and say so instead of skipping the ClickUp write
silently.

## The board

| Thing     | Id             |
| --------- | -------------- |
| Workspace | `90121969080`  |
| Space     | `90128806607`  |
| Folder    | `901213038300` |
| List      | `901220376152` |

These ids are what every request actually needs — they go directly into the
endpoint path or JSON body. Names are cosmetic and drift (the list above has
already been renamed once); nothing here depends on looking one up.

Members: Rysiek Pręcikowski (`105625477`), Filip Adamiak (`105625478`). Each of
us has our own ClickUp user, so `me` in any tool call resolves to whoever is
running the agent — never hard-code a member id to mean "the developer".

One custom field on the list, `Implementer` (`4aaf7617-f6d2-4b03-aa0c-2e30d7e3294d`,
type `users`, single). It records who wrote the code and does not change hands;
`assignees` records whose move it is now and does.

Statuses, in order — these four are the only ones that exist:

`to do` → `in progress` → `in review` → `complete`

There is no `done`; the closing status is spelled `complete`. Status names are
lower-case and must be passed exactly.

Assignment is not decoration — it answers "whose move is it?". A ticket with no
assignee is waiting for someone to pick it up.

## The flow

Each step is a real ClickUp write, done by whoever's agent is doing that step,
at the moment the step actually happens — not batched at the end.

1. **Pick up** — take a ticket that is `to do` **and unassigned**. An assigned
   `to do` ticket belongs to someone else; leave it. If the user did not name a
   ticket, propose one and wait for a yes before touching it.
2. **Start** — set status `in progress`, assignee `me`, and `Implementer` to
   the same user. Setting `Implementer` here rather than later means it is
   already right when the assignee is cleared in step 3. Create the branch now,
   so the integration has something to link from. Then plan, implement, and
   test — in that order. Opening a PR happens only once that's done, and it
   opens as a **draft** (`/pr`); a draft carries no status change of its own,
   because it isn't finished work yet. The ticket sits at `in progress` for the
   whole draft period, however long that is.
3. **Hand off for review** — once the PR is actually marked ready for review
   (out of draft — never while it's still a draft) and CI is green: set status
   `in review` and **clear the assignee** (`assignees: []`). Empty assignee is
   the signal "this is waiting for a reviewer". `Implementer` stays as it is —
   that is the field that remembers who wrote the code. `/pr` does this step.
4. **Take the review** — the reviewer's agent assigns the reviewer to the
   ticket (`me`) and leaves the status at `in review`. `Implementer` is not
   touched. Never review your own PR (rule 12), and never take a ticket whose
   `Implementer` is you. `/review` does this step.
5. **Close** — after the PR is merged: set status `complete` and set the
   assignee to the ticket's `Implementer`, not the reviewer. The ticket ends up
   owned by whoever wrote the code. Merging itself stays the manual, reviewed
   action rule 12 requires; run `/close-ticket` right after, so this step has
   an owner instead of depending on someone remembering it.

**Every status write in this flow is paired with a short comment** on the same
task, posted in the same call as (or immediately after) the status change —
not a separate housekeeping pass at the end. State what was done and where the
ticket landed, in one or two sentences: what changed, the new status, and who
it's now assigned to if that changed. For example, on step 3: "Bulk-accept
button and XTB ticker normalization done and tested. Status changed to in
review, assigned to nobody (waiting for review)." A comment that only restates
the status ("Moved to in review") is not enough — say what the status change
is actually reporting on.

Nothing moves backwards silently. If a review sends work back, set the ticket
to `in progress` and assign the `Implementer` again; say so in a comment.

### Before every session of work

Check the ticket's current status before writing to it. Someone else may have
moved it. Never assume the status you left it in is still there, and never
overwrite a status you did not expect — report it instead.

### Tools

Four endpoints cover the whole flow, all via `.claude/scripts/clickup.sh`:

- **Read a task** — `GET /v2/task/<taskId>` (custom fields, including
  `Implementer`, come back in the response by default).
- **Find work** — `GET /v2/list/901220376152/task?statuses[]=to%20do` to list
  candidates for step 1.
- **Status and assignee** — `PUT /v2/task/<taskId>` with a body of
  `status` and/or `assignees: {"add":[...], "rem":[...]}`.
- **The `Implementer` custom field** — a separate call, because ClickUp
  handles custom fields outside the task-update body:
  `POST /v2/task/<taskId>/field/4aaf7617-f6d2-4b03-aa0c-2e30d7e3294d` with
  `{"value": {"add":["<new>"], "rem":["<old>"]}}`. Single-user field, so
  reassigning always removes the previous holder in the same call.
- **The PR-link comment** — `POST /v2/task/<taskId>/comment` with
  `{"comment_text": "..."}`.

Example — step 2 ("Start"), setting status, assignee and `Implementer` to
Rysiek in one status write plus one field write:

```bash
.claude/scripts/clickup.sh PUT /v2/task/869ej7nzv \
  '{"status":"in progress","assignees":{"add":[105625477],"rem":[]}}'

.claude/scripts/clickup.sh POST /v2/task/869ej7nzv/field/4aaf7617-f6d2-4b03-aa0c-2e30d7e3294d \
  '{"value":{"add":[105625477],"rem":[]}}'
```

Member ids come straight from the table above — there is no `me` to resolve
anymore.

## Git naming

The GitHub integration links a ticket to code when the **task id appears
anywhere** in a branch name, commit message, PR title, or PR description. The
id for `https://app.clickup.com/t/869ej7nzv` is `869ej7nzv`.

Existing repo conventions stay; the id is added to them.

- **Branch** — `<type>/<slug>-<taskId>`, e.g.
  `feat/positions-view-869ej7nzv`, `fix/cost-basis-rounding-869ej7nzv`,
  `docs/clickup-workflow-869ej7nzv`. Types as in commits: `feat`, `fix`,
  `chore`, `docs`, `refactor`. The slug is English (rule 11) even when the
  ticket title is Polish. Id last, same as the commit trailer and the PR
  title — the readable part comes first.
- **Commit** — conventional subject unchanged, with the id as a trailer:

  ```
  feat(web): portfolio positions view

  <body>

  CU-869ej7nzv
  Co-authored-by: Claude Opus 5 <noreply@anthropic.com>
  ```

- **PR title** — `feat(web): portfolio positions view (CU-869ej7nzv)`. The
  title survives a squash merge, so this is the link that stays on `main`.

One ticket, one branch, one PR (rule 15). If a ticket turns out to be two
changes, split the ticket, not the PR.

Do **not** use ClickUp's `#taskId[status]` magic-comment form in commits or PR
text. Status is set explicitly through the API by the step that owns it; two
mechanisms writing the same field is how a board starts lying.
