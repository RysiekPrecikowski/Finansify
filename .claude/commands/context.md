---
description: Load the docs relevant to a task, and nothing else
argument-hint: [what you are about to work on]
---

Task: **$ARGUMENTS**

Read `/CLAUDE.md` first, then read **only** the documents its routing table maps
to this task. Do not read all of `docs/` — each file is written to stand alone,
and reading everything wastes context that the actual work needs.

Then also read:

- any ADR in `docs/decisions/` that the documents you read referenced by number;
- the nearest nested `CLAUDE.md` or `AGENTS.md` to the code you will touch
  (`packages/core/CLAUDE.md`, `apps/web/AGENTS.md`).

Report back, briefly:

1. Which documents and ADRs you read, and why those.
2. The invariants from `CLAUDE.md` that this task could plausibly violate.
3. Whether this task moves a boundary — a new package, a new port, a swapped
   provider, a change to the dependency rule, or a change to any numbered rule.
   If it does, say so, because it needs an ADR in the same change.
4. Anything in the docs that already looks wrong or out of date relative to the
   code. Do not fix it yet; just flag it.

Do not start implementing.
