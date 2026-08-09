# Domain rules

The accounting rules. These are invariants — breaking one produces wrong numbers, not
just awkward code. Read this before touching anything involving money.

## Ownership

- A **user** owns portfolios and accounts.
- An **account** is the accounting container: it holds the ledger and cash, and has exactly one base currency.
- A **portfolio** is a _reporting group only_. It never owns anything.
- An account may belong to several portfolios.

**Therefore:** global totals must aggregate over the _distinct set of accounts_, never over
portfolio membership. An account in two portfolios would otherwise be counted twice.
This is the single easiest way to produce a wrong net worth.

## Money

1. **Never `number`.** Amounts are `Decimal` (decimal.js) in code and `numeric` in Postgres. `0.1 + 0.2 !== 0.3` in binary floating point, and this is an accounting system.
2. **Parse from strings.** `toDecimal('12.34')`, never `Number('12.34')`. ESLint blocks `parseFloat`/`parseInt` inside `core`.
3. **Round only at render.** Intermediate results keep full precision (28 significant digits).
4. **An amount without a currency is meaningless.** Money moves as `{ amount, currency }`.

## Currency conversion

Two distinct steps. Do not collapse them:

1. **Transaction currency → account base currency.** The rate used is stored _on the transaction_, at write time.
2. **Account base currency → display currency.** Applied at read time, and may change per view.

**The stored rate is never re-derived.** If it were recomputed from the rate series, a
later correction to that series would silently change historical balances that the user
already reconciled.

Fees may be in a third currency and carry their own rate.

## Missing data

When a price or FX rate is needed for a date:

1. Use an exact observation if one exists.
2. Otherwise use the **nearest prior** observation, flagged as estimated.
3. If none exists, **fail and show a gap**.

Never extrapolate forward from a later observation, and never silently substitute zero.
A visible gap is a bug report; a fabricated number is a wrong statement of net worth.

Implemented by `findLatestAtOrBefore` in `packages/core/src/time.ts`.

## Ledger

The transaction ledger plus market-data time series is the **only** source of truth.
Every holding, return and chart point is derived from it.

- Cash effect direction: `DEPOSIT` and `SELL` are positive; `BUY` and `WITHDRAW` are negative.
- Raw imported records are **immutable**. Normalized records are editable.
- Every edit writes an `audit_events` row with before/after, in the same transaction as the change.
- Derived aggregates are replaceable and never hand-edited.
- Cost basis is **FIFO** by default, configured per account, and the method used is stored on each snapshot.

## Bonds

Polish retail bonds are **not price-driven**. Their value comes from a computed accrual
schedule, not from a market feed — which is why they need no data provider and can ship
early (ADR [0005](decisions/0005-bonds-before-import.md)).

- **TOS, EDO** — modelled exactly: accrual, coupon frequency, capitalization, early redemption penalty, maturity.
- **COI, ROS** — manual fields for MVP.

Do **not** build a generalized bond template engine. Two real series is not enough to
abstract from safely; hardcoded behaviour is easier to verify against official schedules.
Revisit when a third or fourth series actually needs adding.

## Idempotent imports

Two hash layers, no fuzzy matching:

- **File hash** → batch-level dedupe.
- **Canonical record hash** → record-level dedupe.

Fuzzy/semantic matching is deliberately excluded: a false positive silently drops a real
transaction. If a source format changes, fix the normalizer — do not match around it.

## Time

All timestamps crossing a boundary are **ISO-8601 UTC strings**, never `Date` objects.
`Date` serializes inconsistently between server and client, and these values are compared
across price and FX series.
