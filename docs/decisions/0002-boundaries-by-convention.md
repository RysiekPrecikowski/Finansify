# 0002. Boundaries enforced by convention, not tooling

**Status:** Accepted
**Date:** 2026-08-11

## Context

ADR 0001 establishes a dependency rule: `core` imports nothing, adapters import
only `core`, and only `apps/web` imports adapters. There is a related rule that
`parseFloat`, `parseInt`, and `Number()` must never appear in `packages/core`,
because money is `Decimal` (ADR 0005).

Both are mechanically checkable. ESLint's `no-restricted-imports` and
`no-restricted-globals` can express them exactly, failing the build on violation.

The alternative is to write them down and enforce them in review.

## Decision

Enforce both by convention and code review. No lint rules for package boundaries
or banned globals.

The rules live in `/CLAUDE.md` as numbered invariants and are explained in
`docs/architecture.md`. `CLAUDE.md` stays under roughly 100 lines so it is read
in full rather than skimmed.

## Consequences

No lint configuration to maintain, and no fighting it. Restricted-import rules
are notoriously fiddly to get right across a workspace, and a rule that produces
false positives gets disabled with an inline comment, which is worse than no rule
at all.

**The instruction layer becomes load-bearing.** `CLAUDE.md` is no longer
documentation that would be nice to keep current — it is the enforcement
mechanism. This is the real cost of this decision, and it is why
`docs/README.md` specifies where each kind of writing lives and why a stale rule
is treated as a defect.

Violations will occasionally land. The mitigation is that they are cheap to fix
while the codebase is small, and the boundary is visible in the import statement
itself — a `from '@finansify/db'` inside `packages/core` is obvious to any
reader.

If violations start recurring in review, that is the signal to revisit. This ADR
should then be superseded rather than quietly amended.

## Alternatives considered

**ESLint rules.** Mechanically reliable and the obvious choice for a larger team.
Rejected here because the maintenance and false-positive cost outweighs the
benefit at this size, and because the rules would still need to be documented
anyway — the lint config is not readable as an explanation.

**Both.** Documented rules plus lint as a backstop. Reasonable, and the likely
end state if convention proves insufficient. Deferred rather than rejected: it is
easy to add later, and adding it now would mean tuning a config against a
codebase that does not exist yet.
