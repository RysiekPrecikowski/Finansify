---
description: Record an architecture decision
argument-hint: [what was decided]
---

Record this decision as an ADR: **$ARGUMENTS**

1. List `docs/decisions/` and take the next free number.
2. Check whether an existing ADR covers or contradicts this. If one does, do not edit it — the new ADR supersedes it, and you must set the old one's status to `Superseded by NNNN`.
3. Create `docs/decisions/NNNN-kebab-title.md` using the template in `docs/decisions/README.md`.
4. Add a row to the table in `docs/decisions/README.md`.
5. If this resolves an open question in `docs/roadmap.md`, move it to the Resolved list with a link.

Keep it under one page. What matters most, in order:

- **Alternatives** — what was rejected and why. Without this the decision gets re-argued.
- **Consequences** — what it costs us, stated honestly. If there is no cost, it was not a real decision.
- **Revisit when** — a concrete trigger, not "when needed".

Write plainly. Do not restate the codebase; capture the reasoning that is not visible in it.
