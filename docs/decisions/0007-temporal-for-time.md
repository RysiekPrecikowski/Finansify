# 0007. Temporal for internal time handling

**Status:** Accepted
**Date:** 2026-08-11

## Context

Finansify's time handling is unusually demanding for an app of its size:

- Trade dates and settle dates are **calendar dates**, not instants. A trade on
  11 August is on 11 August regardless of the reader's timezone.
- Market sessions are **wall-clock times in an exchange's timezone**, and the
  market calendar has to answer "is GPW open right now" across DST transitions.
- Bond interest periods are **anniversaries**: EDO capitalizes annually on the
  issue date for ten years.
- Price bars are **instants** at 15-minute, hourly, and daily resolution.

JavaScript's `Date` is a single type for all of these. It is an instant that
prints like a local date, which is the source of the entire category of
off-by-one-day bugs.

## Decision

`packages/core` uses **Temporal** via `temporal-polyfill` for all internal time
handling. Types are chosen deliberately:

- `Temporal.PlainDate` for trade dates, settle dates, and FX rate dates.
- `Temporal.ZonedDateTime` for market sessions.
- `Temporal.Instant` for price bar timestamps.
- `Temporal.Duration` and `Temporal.PlainDate.add` for bond interest periods.

Conversion to and from `Date` happens only at boundaries — the database driver,
JSON serialization, and rendering — and is confined to the `time` module in
`core` and to adapter code.

Formatting for display uses `Intl.DateTimeFormat` at the UI edge, never in
`core`.

## Consequences

The type system starts carrying the distinction that actually matters. A function
taking `PlainDate` cannot be handed an instant, so "which day is this in whose
timezone" stops being a question that can be got wrong silently.

Date arithmetic becomes correct by default. `plainDate.add({ years: 1 })` handles
leap years, and `zonedDateTime.add({ hours: 1 })` handles DST — both are places
where `Date` arithmetic is quietly wrong.

The costs: a polyfill dependency in a package that otherwise has almost none, and
a conversion layer at every boundary. Library interop is the friction point —
most of the ecosystem speaks `Date`, so adapters do translation work.

Temporal is also newer than the training data of most tooling and assistants, so
incorrect API usage from recall is a likely failure mode. This is one reason it
is confined to a single module rather than used ad hoc.

## Alternatives considered

**Native `Date`.** No dependency, universally understood. Rejected because it
cannot express a calendar date, which is the type most of this domain actually
needs.

**date-fns or Luxon.** Mature and well documented. Luxon in particular models
zones well. Rejected because Temporal is the standard both are converging
towards, the polyfill is stable, and adopting a library now means migrating
later. date-fns additionally still represents everything as `Date`, so it does
not solve the underlying type problem.

**Storing everything as an ISO string and doing arithmetic ad hoc.** Rejected as
the failure mode itself, not an alternative to it.
