# 0007 — Temporal, via a polyfill, for internal time arithmetic

**Status:** Accepted
**Date:** 2026-08-10

## Context

`docs/domain.md` already commits to ISO-8601 UTC strings at every module boundary,
never `Date` -- `Date` serializes inconsistently between server and client, and
timestamps here are compared across price and FX series. `packages/core/src/time.ts`
enforced that boundary but leaked `Date` right back in on the inside: it parsed with
`Date.parse` and compared raw epoch milliseconds. `Date.parse` also accepts non-ISO
input inconsistently across engines, which is exactly the kind of inconsistency the
boundary rule exists to avoid.

Phase 2 (the ledger) is about to add real date arithmetic -- holding periods, tax-lot
ages, settlement dates -- where epoch-millisecond math gets error-prone fast. `Temporal`
is the right primitive for this: immutable, explicit about instants vs. calendar dates,
and it compares safely. It is not yet a stable JS engine feature, though:

```
$ node -e "console.log(typeof Temporal)"
undefined
$ node --v8-options | grep -i temporal
  --harmony-temporal (enable "Temporal" (in progress / experimental))
```

Confirmed on the project's actual runtime (Node 24.11.0) -- still TC39 Stage 3, shipped
in V8 only behind an experimental flag Vercel gives no control over. A polyfill is
required either way, so the choice is which one, not whether.

## Decision

Added `temporal-polyfill` (~9 KB, passes the official TC39 spec test suite) as a
dependency of `packages/core`, where the only time logic in the codebase lives.
`@js-temporal/polyfill`, the official reference implementation, was the alternative --
see below.

`packages/core/src/time.ts` now parses ISO strings into `Temporal.Instant` and compares
with `Temporal.Instant.compare`. `Temporal` itself is not re-exported; callers outside
`time.ts` (`ledger.ts`, `fx.ts`, `valuation.ts`) use its semantic helpers --
`isAtOrBefore`, `findLatestAtOrBefore` -- the same shape as before, just backed by
`Temporal` instead of epoch numbers. This keeps `Temporal` an implementation detail of
one file rather than a new import scattered across `packages/core`.

The project's Node baseline moved from `>=22` to `>=24` (root `package.json` `engines`,
CI's `actions/setup-node`) alongside this, since `temporal-polyfill` targets modern
runtimes and there was no reason to keep testing against an older floor.

## Alternatives

| Option                                    | Why not                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@js-temporal/polyfill` (official)        | Canonical and spec-accurate, but ~50 KB+ and slower; `temporal-polyfill` passes the same spec suite at a fraction of the cost                    |
| Keep `Date` / `Date.parse`                | The exact inconsistency `docs/domain.md` already rejects at the boundary; ledger date arithmetic would make it worse, not better                 |
| `date-fns` / `Luxon` / `dayjs`            | All solve the same problem with a non-standard API that becomes throwaway once Temporal ships natively; Temporal is the eventual platform answer |
| Wait for native Temporal, no polyfill yet | Still V8-experimental and flag-gated on the project's own Node 24 runtime (verified above); no ship date to wait for                             |

## Consequences

- One more dependency (`temporal-polyfill`) in `packages/core`, pinned exactly (`1.0.3`) to match the existing convention for `decimal.js` and `zod`.
- `Temporal` stays internal to `packages/core/src/time.ts`; nothing in `packages/db` or `apps/web` touches it, so the boundary rule in `docs/domain.md` is unchanged, just implemented more precisely.
- Node baseline is now 24 everywhere the project specifies one (`package.json` engines, CI). No code currently requires 24 specifically -- this is a floor-raise for the polyfill's benefit, not a hard runtime dependency yet.
- `toEpochMilliseconds` no longer exists; the one external caller (`ledger.ts`) was moved to the new `isAtOrBefore` helper instead of keeping a numeric epoch API alive.

## Revisit when

Node ships `Temporal` unflagged and Vercel's runtime picks it up -- at that point drop
`temporal-polyfill` and import `Temporal` as a global, with no change to the rest of
`packages/core`'s API.
