---
description: Check that the docs still describe the code that exists
argument-hint: [optional: area to focus on]
---

Check whether the documentation still matches reality. Focus: **$ARGUMENTS**
(if empty, check everything changed on this branch).

Start from `git diff main...HEAD --stat` to see what actually moved, then verify
each of these against the code as it now exists:

1. **`/CLAUDE.md` invariants.** For each numbered rule, is it still true, and is
   it still enforceable? A rule that the code has quietly outgrown is worse than
   no rule — it teaches everyone the file can be ignored.
2. **`docs/architecture.md`** — do the packages, the dependency arrows, the port
   list, and the caching layers match what is there? Are there ports in the code
   that the document does not mention?
3. **`docs/domain.md`** — do the table list, the transaction columns, and the
   computation pipeline match the schema and `packages/core`?
4. **`docs/data-sources.md`** — does every provider in `packages/providers`
   appear, with its real TTL and its real failure behaviour?
5. **`docs/roadmap.md`** — are completed phases still listed as pending? Are the
   open questions still open?
6. **ADRs** — did anything in this diff contradict an accepted ADR? If so, that
   is either a bug in the code or a decision that needs superseding. Say which.
   Never edit an accepted ADR's decision; supersede it with a new one.
7. **`docs/README.md`** — the skills table lists which skill lands in which
   phase. Does a skill now exist that should be listed, or is one listed that
   should now exist?

Report findings as a list, each with the file, what the doc says, and what the
code actually does. Propose the edit for each, but do not apply anything until
told which to take.

If everything matches, say so plainly rather than inventing findings.
