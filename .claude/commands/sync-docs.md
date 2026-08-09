---
description: Update the roadmap and docs after finishing a piece of work
---

Reconcile the docs with what actually changed. Run this after finishing a roadmap item.

1. `git diff main...HEAD --stat` (or `git diff --stat`) to see what actually changed.
2. Update `docs/roadmap.md`:
   - Tick completed items. Only tick what is genuinely done — a checkpoint that has not been verified by hand is not done.
   - Update "Where we are" and the `Last updated` date.
   - Add any new open question the work surfaced, with the phase it blocks.
3. Only if an **invariant** changed, update `docs/domain.md`. New features do not belong there — it holds rules, not inventory.
4. Only if a **package boundary, data flow, or external dependency** changed, update `docs/architecture.md`.
5. If a non-obvious choice was made along the way, propose an ADR (`/new-adr`). Do not write it silently.

Rules:

- `docs/roadmap.md` is the only file that should change routinely. If you are editing the others often, something is being written in the wrong place.
- Do not add status, changelogs, or "recently added" sections to any doc other than the roadmap.
- Keep every file readable in one sitting. If one is outgrowing that, say so instead of trimming meaning out of it.

Report what you changed and what you deliberately left alone.
