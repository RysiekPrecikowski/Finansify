# 0019. Bond values come from the published interest tables

**Status:** Accepted
**Date:** 2026-08-18

Supersedes ADR 0016's conclusion that the daily interest tables are unreachable
for a non-interactive client, and its rejection of reading them at runtime.
Every claim below was verified by request against the live API on 2026-08-18,
not recalled and not inferred from the earlier ADR.

## Context

A retail treasury bond has no market price. Until now its value came entirely
from `accrueBond`, our reproduction of the Ministry's accrual rules — periods
anchored to settlement, the published day-count, capitalization, index
selection, three early-redemption regimes. That engine is golden-tested to the
grosz against 2990 published day-values across five families, including 22 real
NBP rate resets, so it is not in doubt. It is, however, _ours_: every figure it
produces depends on our reading of the terms, on the CPI print we picked, and
on a day-count rule that took two corrections to get right.

The Ministry's own daily tables are the figure the holder is actually paid.
ADR 0016 concluded they could not be obtained — obligacjeskarbowe.pl serves them
from a POST form behind PKO's WAF, which answers 403 — and rejected runtime use
on that basis. Bank Pekao S.A., a second emission agent, publishes the same
official tables over a plain JSON REST API: no authentication, no CSRF token, no
WAF. That changes what is possible, so it changes the decision.

One objection to using the API as the primary source was raised and is wrong,
and correcting it is half of why this ADR exists. The endpoint keys its tables
on `{period}-{purchase day}`, and the purchase-day half only ever takes the
values 1, 29, 30 and 31 — which looks like coverage of four days in thirty. It
is not. A published daily value is a function of **(rate, period length, days
elapsed)** and never of the calendar: `ROR0726/9-1` covers 01.03–01.04 and
`ROR0726/8-31` covers 28.02–31.03, both at 4,00% across 31 days, and the two
tables are identical value for value. A purchase on any day from the 2nd to the
28th runs to the same day of the following month, so its period has the same
length as one bought on the 1st and therefore the same table, read at an offset.
The month ends are the only days where the length changes, and they are exactly
the days that get their own keys. Coverage of purchase days is complete.

## Decision

**A bond's value is the published table's, and `accrueBond` is the fallback.**
Per lot, in order: the table already stored, then a lazy fetch, then the engine.

**The tables are cached in `bond_interest_tables`**, global and unscoped like
every other reference table (ADR 0010), keyed on `(series_code,
purchase_day_key, period_ordinal)` — the triple that _is_ the table's published
identity. Fetching is lazy in ADR 0011's sense: nothing is fetched for a series
nobody holds. A stored table is never refreshed, because an agent publishes a
period's whole daily table as soon as its rate is known rather than a row a day;
only a holding rolling into a new period goes back to the network.

**A value our engine computed is never written to that table.** The row is a
claim that an agent published the figure. Storing our own arithmetic there would
freeze a series onto our numbers permanently, when the point of the fallback is
that it stops applying the day the official table appears.

**Every accrual says where it came from.** `BondAccrual.source` is the provider
name or `'computed'`, and a position that mixes the two reports `'computed'` —
an official-looking label on a partly-ours total is the one outcome the field
exists to prevent.

**The offset is checked, not trusted.** `readInterestTable` compares the
published span against the holding's own period and refuses anything that is
neither an exact match nor the one-day-shorter form a capitalizing family is
published in. A mismatch falls through to the engine rather than reading a
28-day table against a 31-day period.

## Consequences

The number on the screen is the Ministry's, so it cannot drift from what the
holder is paid — no index history, no margin and no day-count rule stand between
the published figure and the display. It also gives the two published rates a
holder actually asks about (the period that just closed, and the one running)
without deriving either.

The engine does not become dead code, and must not be treated as such. Three of
the eight families — OTS, ROS, ROD — have no published tables at all: OTS pays
one sum at redemption and has no daily table, and the family bonds are
distributed only by PKO, whose tables stay behind the WAF. Those are valued by
`accrueBond` permanently, as is any holding whose table has not been published
yet or whose span does not line up. Both paths therefore stay under test, and
`value-from-tables.test.ts` asserts they agree to the grosz where both can
answer — a disagreement is a real finding in whichever direction it falls.

The costs are real. `/portfolio` now depends on an emission agent's availability
for the _first_ render of a series, which is why a failed fetch is reported and
degraded rather than thrown; a down Pekao means engine figures, not an error
page. The parser is exposed to a payload shape we do not control — a calendar
grid of Roman-numeral month columns with blank cells — so it validates hard and
refuses a table it does not understand rather than reading one wrongly. And a
second source of truth for the same quantity means a discrepancy is now
possible; the cross-check test is what turns that from a risk into a signal.

## Alternatives considered

**Keep `accrueBond` primary and use the tables only as a CI conformance check.**
This was the previous proposal on the ticket, and it rested on the coverage
claim corrected above. It is still worth having as a test — the golden fixtures
are frozen, so nothing today would catch the Ministry changing a rule — but as
the _source_, it declines the authoritative figure in favour of our
reproduction of it for no benefit.

**Fetch every series' tables on a schedule.** Rejected for ADR 0011's reason:
hundreds of series, up to 144 periods each, nearly all of them held by nobody.
Lazy resolution fetches exactly what someone holds.

**Store the daily values as `numeric[]`.** Rejected in favour of `jsonb` holding
decimal strings. These are money and arrive rounded to the grosz; strings
round-trip to `Decimal` unchanged, and nothing in the path can put them through
a double (rule 1).

**Normalize the published period bounds onto our own period convention when
storing.** Rejected: the difference between the two conventions — a capitalizing
family's table opens the day after the previous one closes — is the only signal
that tells the two publishing shapes apart. Flattening it at the storage edge
would discard the thing the reader needs.
