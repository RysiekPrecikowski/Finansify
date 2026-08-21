# Architecture Decision Records

One decision per file, named `NNNN-kebab-title.md`, numbered sequentially.

## The two rules that make these worth keeping

**Never edit an accepted ADR's decision.** Changing your mind writes a _new_ ADR
that supersedes the old one; the old one stays readable, with its status updated
to point at the replacement. The value of an ADR is the reasoning trail, and
editing in place destroys exactly that.

**Write it when the boundary moves, not afterwards.** The trigger is mechanical:
a new package, a new port, a swapped provider, a change to the dependency rule,
or a change to any rule in `/CLAUDE.md`. If you are unsure whether something
qualifies, it probably does — a short ADR costs less than an unexplained
constraint six months from now.

## Index

| #    | Title                                                                  | Status                           |
| ---- | ---------------------------------------------------------------------- | -------------------------------- |
| 0001 | Hexagonal architecture with four packages                              | Accepted                         |
| 0002 | Boundaries enforced by convention, not tooling                         | Accepted                         |
| 0003 | Ledger-first, everything derived on read                               | Accepted                         |
| 0004 | Mutable ledger with soft delete, not event sourcing                    | Accepted                         |
| 0005 | Exact-decimal money                                                    | Accepted                         |
| 0006 | Four currencies, and the executed FX rate is stored                    | Accepted                         |
| 0007 | Temporal for internal time handling                                    | Accepted                         |
| 0008 | Database engine                                                        | Accepted                         |
| 0009 | Auth behind a port, with our own user identity                         | Accepted                         |
| 0010 | Market data shared globally, portfolio data isolated                   | Accepted                         |
| 0011 | Bond terms resolved on first use                                       | Accepted                         |
| 0012 | Repository language, branch protection, file minimalism                | Accepted                         |
| 0013 | Application-level encryption at rest                                   | Withdrawn, deferred to Phase 1.5 |
| 0014 | Lazy price ingestion, single provider, exchange required               | Superseded in part by 0022       |
| 0015 | The import boundary: what a StatementParser owns                       | Accepted                         |
| 0016 | Where bond reference data actually comes from                          | Proposed, corrected by 0019      |
| 0017 | A pre-production database, rehearsed before production                 | Accepted                         |
| 0017 | NBP, not a market feed, for FX history                                 | Superseded in part by 0018       |
| 0018 | The FX source is the reader's choice, scoped                           | Accepted                         |
| 0018 | Self-merge permitted after green CI                                    | Accepted                         |
| 0019 | Bond values come from the published interest tables                    | Accepted                         |
| 0020 | Portfolio value history: derived on read, backfilled once              | Accepted                         |
| 0021 | Cost basis lives in the position's settlement currency                 | Accepted                         |
| 0022 | Provider chain, per-kind capabilities, non-sticky fallback             | Accepted                         |
| 0023 | Catalyst bonds are a new InstrumentKind, valued by quote × nominal     | Accepted                         |
| 0024 | Aggregated search for bankier, a dedicated use case for Catalyst bonds | Accepted                         |

## Template

```markdown
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD

## Context

What forced a decision. The constraints, not the solution.

## Decision

What we are doing, stated plainly and in the present tense.

## Consequences

What this makes easy, what it makes hard, and what it costs. Include the
downsides — an ADR with no negative consequences is a decision that was never
really made.

## Alternatives considered

What else was on the table and why it lost. One paragraph each is enough.
```
