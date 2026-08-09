---
description: Verify, commit, and open a PR
argument-hint: [optional: what this change does]
---

Get the current work committed and up for review. Context: **$ARGUMENTS**

1. **Verify.** Run `pnpm check` (lint + typecheck + test). If anything fails, fix it and rerun. Do not proceed with failures — and never disable a lint rule to get past a boundary error; move the code instead.
2. **Review your own diff.** `git diff` and `git status`. Look for debug logging, commented-out code, stray `TODO`s, and anything accidentally staged. Confirm no `.env.local` or secret is included.
3. **Branch.** If on `main`, create a branch: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
4. **Commit** using Conventional Commits. One logical change per commit. The subject says what changed; the body says _why_, if it is not obvious.
5. **Ask before pushing.** Show the commit(s), then confirm before `git push` or opening a PR.

If the work completed a roadmap item, run `/sync-docs` **before** committing so the doc
update lands in the same PR.
