---
description: Pre-PR checklist — verify, then summarize what is ready
---

Get this branch ready for review. Work through it in order and stop at the first
thing that genuinely fails.

**1. It works.**

```bash
pnpm check
```

Report the real result. If something fails, show the output and fix it — do not
describe the failure as a caveat and continue.

**2. It respects the boundaries.** These are enforced by review rather than lint
(ADR 0002), so this is the check that actually catches them. Look at the diff:

- Does anything in `packages/core` import from the workspace, React, Next, a
  driver, or call `fetch`?
- Does `parseFloat`, `parseInt`, or `Number()` appear in `packages/core`?
- Do `db`, `providers`, or `importers` import each other?
- Does anything outside `apps/web/src/lib/auth/` import `@clerk/nextjs`?
- Does any user-scoped query bypass `forUser(userId)`?
- Does any `use cache` over user data omit the user id from its key?

**3. Docs ship with it.** If the change moved a boundary — a new package, a new
port, a swapped provider, a change to the dependency rule, or a change to any
numbered rule in `/CLAUDE.md` — there must be an ADR in this same change. If a
change made a document wrong, fix the document now. Run the same checks
`/sync-docs` does for the areas this branch touched.

**4. Then summarize**, and only then:

- What changed and why, in a few sentences.
- Which phase of `docs/roadmap.md` this advances, and whether it completes it.
- Anything deliberately left out, stated plainly.
- Anything you were unsure about that a reviewer should look at closely.

Do not commit, push, or open a PR unless asked.
