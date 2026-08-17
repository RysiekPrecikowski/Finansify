---
description: Review a diff, branch, or PR against Finansify's own invariants — boundaries, money, caching, conventions
argument-hint: [optional: PR number or branch — defaults to the current diff against main]
---

Review **$ARGUMENTS** (empty means: the current working diff, or `main...HEAD`
if the tree is clean) against this repo's own rules. This is not a general
correctness/style pass — that's `/code-review`. This command exists because
generic review has no way to know these rules; it only catches what a reviewer
who has read `/CLAUDE.md` would catch.

**1. Show open PRs, then confirm the target.** Before anything else, run
`gh pr list --state open --json number,title,isDraft,headRefName,url` and
print it as a table (PR, title, branch, status) — status is `draft` or `ready
for review`. Draft is excluded from the default selection: if $ARGUMENTS is
empty, propose the ready (non-draft) PRs as candidates, not the drafts — a
draft is explicitly "not ready for anyone to spend review time on" (`/pr`).
If $ARGUMENTS names a specific PR or branch (including one that turns out to
be a draft), show it in the table like the rest but confirm explicitly that a
draft is intended before reviewing it — don't refuse, just don't default into
it silently. Wait for confirmation of which PR this run is actually reviewing
before moving to step 2.

**2. Get the real diff.**

```bash
gh pr diff <confirmed-PR>     # if reviewing a PR number
git diff main...<branch>      # if $ARGUMENTS is a branch
git diff                      # otherwise, working tree
```

**3. Read `/CLAUDE.md` in full**, plus `packages/core/CLAUDE.md` and
`apps/web/AGENTS.md` if the diff touches those trees.

**4. Walk every changed hunk against this checklist.** Don't skim — a
violation is often a single import line or one raw number:

- **Money** — any `parseFloat`, `parseInt`, or `Number()` inside
  `packages/core`? Money handled as `Money`/`Decimal` everywhere it moves?
- **Core purity** — anything in `packages/core` importing another workspace
  package, React, Next, a DB driver, or calling `fetch`?
- **Adapter isolation** — `db`, `providers`, `importers` importing each other?
- **User scoping** — every user-scoped query going through
  `repository.forUser(userId)`? Any unscoped path?
- **Cache keys** — every `use cache` over user data taking the user id as an
  argument? Anything shared globally that shouldn't be (or vice versa)?
- **FX rate** — is an executed FX rate stored on the transaction, or is a
  historical rate being reconstructed after the fact?
- **Missing prices** — is a missing/stale price ever estimated, interpolated,
  or substituted, instead of shown as stale-with-timestamp or not shown?
- **Imports** — intra-package imports extensionless?
- **Migrations** — anything running a migration from a build step rather than
  CI-on-merge?
- **Next 16** — `proxy.ts` not `middleware.ts`; Cache Components used
  correctly; nothing that looks like a `middleware.ts`-era pattern copied from
  training data.
- **Language** — any Polish (or other non-English) in code, identifiers,
  comments, or the commit/PR text itself?
- **File count** — a new file where extending an existing one would have done?
  A third near-duplicate of an existing pattern?
- **Boundary + ADR** — does this diff move a boundary (new package, new port,
  swapped provider, changed dependency rule, changed numbered CLAUDE.md rule)?
  If so, is there an ADR in the same diff? Its number, and does its content
  actually match what the code does?
- **UI conventions** (`apps/web/AGENTS.md`, only if UI changed) — green/red
  used only for P&L? Tables going through `<DataList>` rather than a hand
  rolled responsive table? Stale data labeled with its timestamp? An
  unvaluable position shown as such rather than dropped?
- **Security & data integrity** — does this touch auth, money movement, or a
  migration? If so, flag that `/security-review` should run before merge if it
  hasn't.
- **Docs** — does anything in the diff make a doc in `docs/` wrong? If yes,
  say which document and suggest running `/sync-docs`.

**5. Report with `ReportFindings`.** One finding per violation, file and line,
most severe first (a money-as-float or a cross-user cache leak outranks a
missing extensionless import). If a hunk is fine, do not invent a finding to
have something to say — an empty list is a valid, correct result.

**Tone.** Findings are read and acted on by the other teammate, which makes
them different from the terse narration a session emits while working.

- Name the exact thing — the file, the line, the number — and its concrete
  consequence. Never a verdict on the person who wrote it: "this reconstructs
  the rate at read time, which rule 6 forbids because brokers convert at their
  own spread", not "sloppy FX handling".
- Concrete and kind are not in tension. "Worth a look" instead of a bare
  imperative, or a short acknowledgment of a good call, costs nothing — but it
  never replaces the specific location the other person needs in order to act.
- No hedging ("might want to consider"), no filler adjectives, no emoji.
  Warmer is a register, not an excuse to get vaguer.

Everything posted to GitHub is **English**, review comments included (rule 11).

Do not silently fix anything. This command reviews; `/code-review --fix` or a
human applies the fix.

**Replying to a review you received.** If a PR comes back as "Changes
requested" and carries inline comments, replying to every one of them is
mandatory, not optional politeness — fix first, then reply, in that order:
implement the fix for a comment before answering it, so the reply reports what
actually happened rather than what's planned. Answer each comment where it was
left, in English, short and factual: what changed, and — only when the choice
was not obvious — why that option rather than the alternative the reviewer
named. The reviewer already read the code; the reply exists so they can tell
their point was understood, not to brief them on the diff. If a reply starts
needing headings or a bullet list of everything touched, that belongs in the
PR description instead. Say plainly when a point was declined and why, rather
than answering around it — and never mark the review resolved yourself; that's
the reviewer's call once they've seen the replies.

**Take the ticket while reviewing.** When reviewing a PR that carries a ClickUp
id (branch or title, `CU-<id>`), read it first — `.claude/scripts/clickup.sh
GET /v2/task/<taskId>` — and confirm `Implementer` is not you (never review
your own PR, CLAUDE.md rule 12). Then assign the reviewer:
`.claude/scripts/clickup.sh PUT /v2/task/<taskId>
'{"assignees":{"add":[<reviewerId>],"rem":[]}}'` — omit `status` so `in
review` is left as-is; an unassigned `in review` ticket means nobody has
picked the review up. Do not touch `Implementer`; it names the author and
stays that way.
