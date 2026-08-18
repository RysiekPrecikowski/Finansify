# 0018. Self-merge permitted after green CI

**Status:** Accepted
**Date:** 2026-08-18

## Context

ADR 0012 made review-and-approval mandatory before merge to `main`, on the
premise that two people touching the same ledger and money code is exactly
the situation review exists to protect. In practice this has become a
bottleneck: the two of us don't always overlap in availability, and a small,
low-risk PR sits `in review` waiting on a person who may be offline for
hours. That friction was starting to push the other direction — toward
fewer, bigger PRs, to make the wait worth it — which undoes the point of
cutting small PRs in the first place.

## Decision

Review from the other teammate becomes optional, not blocking. CI green (the
`check` job) is what gates a merge; a human review is still welcome and
requested by default, but merging no longer waits on it.

This supersedes the mandatory-approval half of ADR 0012's decision 2 and
`/CLAUDE.md` rule 12. The rest of rule 12 — PR-only, no direct pushes, no
force-pushes, no `--no-verify` — is unchanged.

`docs/clickup.md`'s flow step "Take the review" is now optional: a PR can go
`in review` → merged → `complete` without anyone taking it, as long as CI is
green.

## Consequences

Small PRs stop queuing on a person's availability, which was the actual
friction. The cost is the thing review existed to catch: a mistake in money,
auth, or migration code that CI's test suite doesn't cover. That risk
doesn't disappear, it moves — `/CLAUDE.md`'s "Definition of done" already
requires an explicit second look and `/security-review` for exactly that
category of change, so the safety net for the highest-risk changes is a
deliberate look at merge time, not a blanket approval gate on everything.

If GitHub branch protection on `main` was ever configured with "Require
approvals: 1" (ADR 0012 noted this was never applied, for lack of admin
access), it needs to drop to 0 approvals while still requiring the `check`
status check — otherwise the written rule and the enforced one disagree.

## Alternatives considered

**Optional only below some risk threshold, mandatory for money/auth/
migrations.** Rejected: it needs "low-risk" defined precisely enough for a
human and an agent to apply the same way every time, and the definition-of-
done review requirement already exists for that category independent of
merge gating. A uniform rule plus the existing risk-based review requirement
covers the same ground without a second, overlapping threshold to maintain.
