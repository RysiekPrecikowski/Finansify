---
description: Orient at the start of a session — current state, next task, relevant rules
---

Get oriented before doing any work. Be efficient: read only what is needed.

1. Read `docs/roadmap.md` — this is the state file. Identify the current phase and the next unchecked item.
2. Read `docs/domain.md` **only if** the upcoming work touches money, FX, accounts, the ledger, or bonds.
3. Read `docs/architecture.md` **only if** the work adds a route, a table, or crosses a package boundary.
4. Run `git log --oneline -10` and `git status` to see what has happened recently.

Do **not** read every file in `docs/`. Do not read the ADRs unless you are about to
contradict a decision — if you are, read that ADR first and say so explicitly.

Then report, in under 15 lines:

- Current phase and what is done
- The next unchecked roadmap item
- Any open question in `docs/roadmap.md` that blocks it
- Anything in the working tree that looks unfinished

Ask what to work on. Do not start until told.
