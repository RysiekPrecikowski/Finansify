# 0015. Where bond reference data actually comes from

**Status:** Proposed
**Date:** 2026-08-14

Corrects two rows of `docs/data-sources.md`, in the same way ADR 0014 corrected
its Stooq entries: by making requests rather than by reading documentation.

## Context

The bond accrual engine needs three things it cannot compute: the NBP reference
rate (ROR, DOR), Polish CPI year-on-year (COI, ROS, EDO, ROD), and each issue's
own first-period rate and margin. `docs/data-sources.md` named a source for each
and ADR 0011 assumed all three would eventually automate. Both were written
before anyone tried.

Every claim below was verified by request on 2026-08-14, not recalled.

## Decision

**The NBP reference rate comes from `static.nbp.pl/dane/stopy/stopy_procentowe.xml`**,
with `stopy_procentowe_archiwum.xml` for history. 3 KB and 37 KB respectively,
one GET, no key, full history to 1998-02-26. Values carry a comma decimal
separator and become `Decimal` at the adapter edge.

Worth stating because it is the natural wrong guess: **`api.nbp.pl` does not
serve this.** It describes itself as a public Web API for exchange-rate tables
and gold prices, and that is all it has. Any plan routed through
`api.nbp.pl/api/exchangerates/...` or `/api/cenyzlota/` for a reference rate is
built on something that does not exist.

**Polish CPI comes from the GUS monthly CSV**, not from the BDL API:

```
stat.gov.pl/download/gfx/portalinformacyjny/pl/defaultstronaopisowa/4741/1/1/
  miesieczne_wskazniki_cen_towarow_i_uslug_konsumpcyjnych_od_1982_roku__2_2.csv
```

230 KB, `;`-delimited, **cp1250**, comma decimals. Filtering
`Sposób prezentacji` to `"Analogiczny miesiąc poprzedniego roku = 100"` yields
540 monthly observations from 1982-01. Future months of the current year are
present as **empty rows** and must be skipped rather than read as zero.

**The BDL API cannot serve this and was rejected on evidence.** `bdl.stat.gov.pl`
publishes CPI only as annual (`P2955`, COICOP 1999, through 2025) and quarterly
(`P4635`, COICOP 2018, from 2026); variable `217230` returns year-keyed values.
The indexed families need the monthly year-on-year print, which BDL does not
expose at any granularity. GUS's newer DBW API (`api-dbw.stat.gov.pl`) is
reachable but has no consumer-price area at all — all 253 areas under `Ceny`
were enumerated — and its `variable-search` endpoint 404s.

**Per-issue parameters come from obligacjeskarbowe.pl's current offer pages**,
one GET each, e.g. `/oferta-obligacji/obligacje-10-letnie-edo/edo0836/`, which
states both numbers in prose: "5,35% w pierwszym rocznym okresie odsetkowym …
marża 2,00% + inflacja".

**This reaches the current month only, and there is no automated path to
history.** Both the daily interest tables (`/tabela-odsetkowa/`) and the
emission-letter archive (`/archiwum-listow-emisyjnych/`) are Django POST forms
behind PKO's WAF, which answers `403 "PKO Bank Polski – Przerwa techniczna"`.
That was tested with a valid CSRF token, a live session cookie, `Origin` and
`Referer` headers, and a genuine headless Chromium driving the real form — not
only with `curl`. The option-value GET URLs 404, and query parameters on the
table view are ignored, always returning the default series.

## Consequences

**ADR 0011's tier 2 is load-bearing, not a nicety.** Committed bootstrap data in
`packages/providers/src/mf/data/` is the only route to historical issues, and
the manual-override tier is a permanent escape hatch rather than a temporary
one. Automation covers the current month, the NBP rate and CPI; nothing else.

**Golden test data is transcribed by hand.** The one interest table reachable by
GET is whichever the page happens to default to. Adding a family's golden test
means a person opening the site in an ordinary browser and saving a PDF — a
one-off authoring step, never a runtime path. `packages/core/src/bonds/__fixtures__/`
holds the result, and each fixture names the PDF it came from.

**A day-count rule was discovered rather than assumed, and it is not the obvious
one.** The published ROR0827 table (purchased 2026-08-31, 4.00%) disagrees with
ACT/365 on 7 of 30 days and with ACT/366 on 8. It matches, on all 30, a twelfth
of the annual rate spread linearly across that period's own day count, rounded
half-up to the grosz per single bond. Generalized: interest for one bond is
`base × annualRate × periodMonths / 12 × elapsedDays / daysInPeriod`.

Two corollaries. Rounding happens **per bond** and is then multiplied by the
holding, because the tables are published "dla 1 sztuki obligacji" — rounding
the holding as a whole pays a different number. And **each family's day count is
a finding to be established from its own table**, never inherited from another's;
only ROR is currently golden-tested, and the rest rest on the published prose
until their tables are collected.

**A wrong value here is silent and long-lived.** A bad CPI print mis-values every
indexed bond for its whole term — ten years for EDO, twelve for ROD. So the
fetchers validate hard and **refuse to write a value that fails a sanity check
rather than guessing**, which is `docs/data-sources.md`'s existing rule applied
to the two feeds that now have a real source.

The corollary is easy to get wrong, and was: **a plausibility band must admit the
source's own history, or it is an outage rather than a check.** The CPI series
peaks at 1283.1 (February 1990, ~1183% year-on-year) and bottoms at 98.4
(February 2015). A first cut capped it at 1000 because a secondary source
described the 1990 peak as "around 640%"; that rejected the real file and took
the entire series down. Bands are set from the data, not from recollection —
and the way this surfaced was running the fetcher against the live source, which
is why `docs/roadmap.md` insists a green test suite is not the same as having
run the thing.

## Alternatives considered

**Scrape the interest tables at runtime.** Rejected: it does not work, and if the
WAF ever relented it would make bond valuation depend on a POST form that PKO
can change without notice.

**Use BDL's quarterly CPI and interpolate to months.** Rejected outright — rule 7
forbids interpolating a missing figure, and inventing inflation prints to value
inflation-linked bonds is the exact failure mode this project is built to avoid.

**Commit the whole CPI history and stop fetching.** Tempting, since the series is
540 rows and changes twelve times a year. Rejected because it puts a pull request
between a published print and a correct valuation, which is the same objection
ADR 0011 raised against committing bond terms. The bootstrap file exists for
history; the fetcher handles the current month.
