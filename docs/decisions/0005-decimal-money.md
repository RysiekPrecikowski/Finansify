# 0005. Exact-decimal money

**Status:** Accepted
**Date:** 2026-08-11

## Context

JavaScript numbers are IEEE-754 doubles. `0.1 + 0.2 !== 0.3`, and errors
accumulate under repeated arithmetic.

Finansify's arithmetic is exactly the kind that accumulates: folding a ledger
into positions, matching lots across many partial sells, compounding bond
interest annually over ten years, and converting between currencies at several
points in a single calculation. A bond engine that must match the official
published interest tables to the grosz cannot tolerate drift at all.

## Decision

Money never exists as a `number`.

- In TypeScript, monetary amounts are `decimal.js` values wrapped in a `Money`
  value object, `{ amount: Decimal; currency: Currency }`. Arithmetic goes
  through `Money` methods, and mixing currencies throws rather than silently
  producing a meaningless result.
- In Postgres, `NUMERIC(28, 10)`. Never `float8`, never the `money` type.
- `parseFloat`, `parseInt`, and `Number()` must not appear anywhere in
  `packages/core`.
- Formatting to a string happens only at the UI edge, via `Intl.NumberFormat`.

## Consequences

Correctness under compounding and repeated conversion, which is the whole point.
The bond engine can be held to an exact standard rather than a tolerance.

Currency mismatches become loud failures at the point of the mistake instead of
quiet wrong numbers downstream. This is a larger benefit than the precision
itself — a multi-currency portfolio has many places to add PLN to USD by
accident.

The costs are real. Arithmetic is verbose: `a.plus(b)` rather than `a + b`. Every
boundary needs an explicit conversion — parsing an import, reading a database
column, rendering to the DOM — and each is a place to get it wrong. `decimal.js`
is a runtime dependency in a package that otherwise has almost none.

Storing money as `NUMERIC` also becomes an input to the database decision, since
SQLite has no decimal type. See ADR 0008.

## Alternatives considered

**Integer minor units** — store grosze and cents as integers. Fast, exact for
addition, and a common choice. Rejected because it is exact only for addition:
FX conversion, percentage allocation, and compounding all reintroduce
fractions, and the rounding then has to be hand-managed at every step. It also
struggles with instrument quantities, which are fractional and not money.

**Floats with rounding at the edges.** Simplest, and what most hobby trackers
do. Rejected outright — this is the failure mode the product's correctness
principle exists to prevent, and it is invisible when it happens.

**Native `BigInt` with a fixed scale.** No dependency and exact. Rejected as
`decimal.js` with extra steps: we would end up writing the same scaling and
rounding helpers by hand, with more chances to get them wrong.
