# 0004. Mutable ledger with soft delete, not event sourcing

**Status:** Accepted
**Date:** 2026-08-11

## Context

"The ledger is the system of record" (ADR 0003) invites an append-only design:
transactions are immutable, and a correction is a reversal entry plus a
replacement. That is standard practice in accounting systems and it is what most
finance-adjacent architectures reach for by default.

It is worth asking what that rigour actually buys, because it is not free. In an
append-only ledger, fixing a typo in a fee produces three rows, and every read
path has to understand reversals.

Append-only exists to do two things: protect stored derived state from drifting
when inputs change, and answer "who changed this, and when" in a system where
multiple parties touch the same records.

## Decision

Transactions are **editable and soft-deletable by their owner**. A correction is
an `UPDATE`. A deletion sets `deleted_at`.

Two guardrails carry the weight that immutability would otherwise carry:

- **`external_id` is unique per account.** Re-importing the same statement never
  duplicates rows and never resurrects a deleted one.
- **`edited_after_import`** marks a row that was corrected by hand. A later
  re-import surfaces it as a conflict for review instead of silently overwriting
  the correction.

## Consequences

Neither justification for append-only applies here. There is no stored derived
state, because ADR 0003 computes everything on read — so an edit is
automatically consistent everywhere, with nothing to invalidate or recompute.
And there is exactly one party: the user is the sole author of their own data.

The result is a tracker where fixing a mistake feels like fixing a mistake.

What is given up is history of the record itself. If a user edits a transaction
and later wants to know what it said before, we cannot tell them. Soft delete
covers accidental deletion, which is the common case; it does not cover
accidental editing, which is rarer.

There is also no defence against a user misremembering. A ledger that can be
rewritten can be rewritten wrongly, and nothing will flag it.

Both are acceptable for a personal tracker and would not be if Finansify ever
handled someone else's money, or stored snapshots that an edit could invalidate.
Either of those is the trigger to revisit — and the schema can grow a revision
table without a rewrite, because nothing downstream depends on rows being
immutable.

## Alternatives considered

**Full append-only with reversal entries.** Correct in the accounting sense and
genuinely necessary in multi-party systems. Rejected as ceremony that this system
does not need, paid on every single correction.

**Append-only plus a projection.** Immutable log with a materialized current view
for reads. Rejected for the same reason as ADR 0003: it introduces stored derived
state, which is exactly the thing that creates drift.

**Hard delete.** Simpler than soft delete. Rejected because it breaks import
idempotency — a hard-deleted row has no `external_id` left to match against, so
the next import silently recreates it.
