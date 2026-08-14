# ClickUp — tickets, statuses, and how git names things

Work is tracked in ClickUp. This document is the whole contract: which board,
which statuses, who is assigned when, and how a branch, a commit and a PR have
to be named so the GitHub integration links them back to the ticket.

Read this before starting any piece of work, not after finishing it.

## The board

| Thing     | Name            | Id             |
| --------- | --------------- | -------------- |
| Workspace | Workspace       | `90121969080`  |
| Space     | Finansify space | `90128806607`  |
| Folder    | hidden          | `901213038300` |
| List      | Project 1       | `901220376152` |

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
   so the integration has something to link from.
3. **Hand off for review** — when the PR is open and CI is green: set status
   `in review` and **clear the assignee** (`assignees: []`). Empty assignee is
   the signal "this is waiting for a reviewer". `Implementer` stays as it is —
   that is the field that remembers who wrote the code. Post the PR link as a
   comment.
4. **Take the review** — the reviewer's agent assigns the reviewer to the
   ticket (`me`) and leaves the status at `in review`. `Implementer` is not
   touched. Never review your own PR (rule 12), and never take a ticket whose
   `Implementer` is you.
5. **Close** — after the PR is merged: set status `complete` and set the
   assignee to the ticket's `Implementer`, not the reviewer. The ticket ends up
   owned by whoever wrote the code.

Nothing moves backwards silently. If a review sends work back, set the ticket
to `in progress` and assign the `Implementer` again; say so in a comment.

### Before every session of work

Check the ticket's current status before writing to it. Someone else may have
moved it. Never assume the status you left it in is still there, and never
overwrite a status you did not expect — report it instead.

### Tools

`clickup_get_task` (`include: ["custom_fields"]` to read `Implementer`,
`expand_statuses` when unsure of a status name), `clickup_filter_tasks`
(`list_ids: ["901220376152"]`, `statuses: ["to do"]`) to find work,
`clickup_update_task` for status, assignees and custom fields,
`clickup_create_comment` for the PR link and anything a reviewer needs to know.

`Implementer` is a `users` field, so its value goes through the add/remove
shape rather than a bare id — to set it to the current user:

```jsonc
// clickup_update_task
{
  "task_id": "869ej7nzv",
  "status": "in progress",
  "assignees": ["105625477"],
  "custom_fields": [
    {
      "id": "4aaf7617-f6d2-4b03-aa0c-2e30d7e3294d",
      "value": "{\"add\":[\"105625477\"]}",
    },
  ],
}
```

Resolve `me` to a numeric id with `clickup_resolve_assignees` first; the custom
field takes ids only. Since the field is single-user, re-assigning it means
also removing the previous holder: `{"add":["<new>"],"rem":["<old>"]}`.

## Git naming

The GitHub integration links a ticket to code when the **task id appears
anywhere** in a branch name, commit message, PR title, or PR description. The
id for `https://app.clickup.com/t/869ej7nzv` is `869ej7nzv`.

Existing repo conventions stay; the id is added to them.

- **Branch** — `<type>/<taskId>-<slug>`, e.g.
  `feat/869ej7nzv-positions-view`, `fix/869ej7nzv-cost-basis-rounding`,
  `docs/869ej7nzv-clickup-workflow`. Types as in commits: `feat`, `fix`,
  `chore`, `docs`, `refactor`. The slug is English (rule 11) even when the
  ticket title is Polish.
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
