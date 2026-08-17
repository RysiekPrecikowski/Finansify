# 0017. NBP, not a market feed, for FX history

**Status:** Superseded in part by 0018
**Date:** 2026-08-16

## Context

The presentation currency (this change) lets the portfolio total be read in
EUR, USD, GBP or CHF. The obvious next question from anyone using it is what
the pair has been doing — a USD/PLN chart with a range picker, alongside the
reference rate and CPI on `/indicators`.

That needs a _history_ of rates, which nothing here had: `fx_rates` was written
one publication day at a time by `refreshFxRates`, and read back only through
`latestFor`. Two sources could supply the history, and the choice is not
obvious, because the app already depends on both.

**Yahoo** is already a dependency (ADR 0014) and quotes FX pairs directly:
`USDPLN=X` returns daily bars, including cross pairs like `EURUSD=X` that need
no PLN leg at all.

**NBP** is already a dependency for table A, and publishes the same table
historically, per currency, over a date range:

```
GET https://api.nbp.pl/api/exchangerates/rates/a/usd/2026-08-03/2026-08-14/?format=json
→ { code: "USD", rates: [{ effectiveDate: "2026-08-03", mid: 3.7330 }, …] }
```

> **Superseded in part by ADR 0018.** Everything measured here still holds, and
> NBP remains the default and the only valuation source unless a reader opts
> out. What 0018 revises is the conclusion that a market feed may not exist in
> the product at all: it may, as a labelled choice with a stated scope.

## Decision

**NBP table A, through the existing `nbpFxRateProvider`**, extended with
`fetchSeriesTo(code, from, to)`. Yahoo stays what it is: the price provider for
instruments.

Rates land in the existing `fx_rates` table, whose primary key is already
`(currency, date)` — a history is what that key was always shaped for, so this
needed no migration and no new table. Cross pairs stay computed rather than
stored (`pairSeries`, the day-by-day form of `convertViaPln`), which is the
rule ADR 0014 set for the single-conversion case.

## Why not Yahoo, given it is already here

**The two sources disagree, and one of them is the number on the page.** Same
days, fetched within a minute of each other:

| day        | NBP mid | Yahoo `USDPLN=X` | difference |
| ---------- | ------- | ---------------- | ---------- |
| 2026-08-03 | 3.7330  | 3.72856          | −12 bps    |
| 2026-08-04 | 3.7468  | 3.74420          | −7 bps     |
| 2026-08-05 | 3.7320  | 3.72390          | −22 bps    |
| 2026-08-10 | 3.7226  | 3.71731          | −14 bps    |

Neither is wrong. NBP fixes a mid around 11:00 CET; Yahoo's daily close is the
last spot tick of its own session. But the portfolio total is converted at the
NBP mid, so a Yahoo chart would sit on the same page as a number computed from
a different series, disagreeing with it by up to 20 bps for no reason a reader
could discover. Sourcing the chart from `fx_rates` makes that class of
disagreement impossible: the chart and the total are the same rows.

Three smaller findings, all from real responses:

- Yahoo returns a **live partial bar** for the current day
  (`2026-08-16T15:52:38Z`), which is an intraday snapshot, not a close. Charting
  it silently mixes a settled series with a moving one.
- Yahoo's closes arrive as **float32 artifacts** (`3.728559970855713`). The
  price adapter already strips these through `priceHint`; NBP publishes exact
  decimals and needs no such step.
- Yahoo is **unofficial and anti-bot gated** (ADR 0014). A five-year MAX window
  is a handful of requests; doing that against an endpoint that can start
  demanding a proof-of-work is a worse bet than doing it against a
  documented public API of the central bank that fixes the rate.

## Consequences

**Weekends and holidays do not exist in the data, and are not filled in.**
Table A is published on business days. A gap is a gap (rule 7); the chart's
step is the reader's own eye, not an interpolated point.

**Cross pairs are bounded by the shorter leg.** EUR/USD is `mid(EUR) /
mid(USD)`, day by day, keeping only dates on which both were published.

**A range wider than 367 days is several requests.** NBP answers a longer range
with a `400`, so the adapter chunks; a `MAX` window (from 2002-01-02, the
archive's start) is roughly two dozen requests, once, after which the rows are
stored and shared by every user.

**A 404 means "no publication in this range", not a failure** — a fortnight of
holidays, or a window predating a currency's entry into table A. The adapter
returns an empty chunk rather than throwing, which is the only reading that
does not take down a chart because one of its chunks fell on a quiet stretch.

**A pair is only available if both its currencies are in table A.** EUR/USD is
offered and works — it is computed through PLN, the same route `convertViaPln`
takes — but a pair whose currency NBP does not publish has no series at all,
and shows as unavailable rather than being sourced from somewhere else. If such
a pair is ever wanted, Yahoo is the source for it, and it will not collide with
a valuation number, because no valuation reads it.
