# Decisions

One decision per file, numbered, append-only.

**Never edit an ADR to change its conclusion.** Write a new one and mark the old one
`Superseded by NNNN`. The point is that a decision made once stays visible — including
the reasoning that would otherwise get re-argued every few months, by us or by an agent.

Write one when a choice would plausibly be questioned later. Skip it for anything obvious.

| #                                          | Decision                                    | Status   |
| ------------------------------------------ | ------------------------------------------- | -------- |
| [0001](0001-platform-vercel-supabase.md)   | Next.js on Vercel with Supabase             | Accepted |
| [0002](0002-three-package-workspace.md)    | Three packages, no build step               | Accepted |
| [0003](0003-lazy-computation.md)           | Lazy computation instead of background jobs | Accepted |
| [0004](0004-drizzle-with-supabase-auth.md) | Drizzle for data, Supabase for auth         | Accepted |
| [0005](0005-bonds-before-import.md)        | Bonds ship before XTB import                | Accepted |

## Template

```markdown
# NNNN — Title

**Status:** Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD

## Context

What forced a choice.

## Decision

What we do.

## Alternatives

What we rejected, and why.

## Consequences

What this costs us.

## Revisit when

The concrete trigger that should reopen this.
```
