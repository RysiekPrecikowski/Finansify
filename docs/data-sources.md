# Data sources

Everything Finansify fetches from the outside world, what each source actually
offers, and how we behave when it breaks.

All of these sit behind ports defined in `packages/core/src/ports/` and are
implemented in `packages/providers`. Nothing in the domain knows any of these
names.

## At a glance

What each kind of thing is priced from, and how often that number can change.
"Refreshed" is our own re-fetch rule; "changes" is how often the upstream number
actually moves — the two are deliberately different, and confusing them is how
a 15-minute TTL gets mistaken for a 15-minute rate.

| Asset / figure                | Source                      | Upstream changes                         | We re-fetch                          |
| ----------------------------- | --------------------------- | ---------------------------------------- | ------------------------------------ |
| Equity, ETF, fund (global)    | Yahoo Finance               | Continuously while the exchange is open  | 15 min (`PRICE_TTL_MINUTES`)         |
| Equity, ETF (GPW)             | Yahoo Finance, `.WA`        | Continuously, 09:00–17:00 CET            | 15 min                               |
| FX rate — **valuation**       | NBP table A (mid)           | **Once per business day**, around midday | 15 min (returns the same row)        |
| FX rate — pair charts         | NBP table A archive         | Once per business day                    | On gap, or newest print ≥ 4 days     |
| Polish retail bonds           | Nothing — accrued in `core` | Recomputed per `asOf`; never quoted      | Never; it is a calculation           |
| Bond interest tables (source) | obligacjeskarbowe.pl, Pekao | Monthly, per issue                       | Bootstrapped; not fetched at runtime |
| NBP reference rate            | NBP XML (`static.nbp.pl`)   | On an RPP decision — a few times a year  | 7 days                               |
| Polish CPI                    | GUS monthly CSV             | Monthly                                  | Once the calendar month advances     |

**Google is not a source here.** `GOOGLEFINANCE` exists only inside Google
Sheets and has no API; where a Google-quoted figure matches ours it is because
both trace back to the same market data, not because we read Google.

**No free source gives an intraday FX rate except Yahoo.** Measured
2026-08-17: frankfurter.dev (ECB) and open.er-api.com both publish once a day,
ECB's XML likewise; Yahoo's `USDPLN=X` moved between two calls twenty seconds
apart with `exchangeDataDelayedBy: 0`. NBP stays the valuation rate regardless —
Polish tax uses the NBP rate from the business day before a transaction, so the
book and the tax return have to agree (ADR 0017, `domain.md`).

## The feeds

| Need                            | Source                                                                 | Reality                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global equity and ETF quotes    | `yahoo-finance2` v4                                                    | Unofficial and actively maintained, but no SLA and no terms guarantee. Server-side only — CORS and cookies make it unusable in a browser. No working free second source exists today (see below); resilience comes from storing every fetched bar, not from provider redundancy — ADR 0014.                                                                                                                             |
| GPW quotes                      | `yahoo-finance2`, `.WA` suffix                                         | Also covers GPW — `PKN.WA` returns `currency: PLN`, `exchangeName: WSE`. Stooq was the planned fallback but is no longer usable: every `stooq.pl/q/d/l/?s=…` request is now behind a proof-of-work anti-bot challenge (SHA-256, verified via POST to `/__verify`), confirmed by direct testing. Not circumvented. There is no free replacement with comparable GPW coverage; the realistic alternatives are paid feeds. |
| FX                              | NBP Web API, `api.nbp.pl`, table A mid rates                           | Free, official, no key, HTTPS-only since August 2025. Publishes on business days only, so it needs last-business-day carry-forward. Non-PLN crosses derive through PLN.                                                                                                                                                                                                                                                 |
| FX history (pair charts)        | Same API, `/exchangerates/rates/a/{code}/{from}/{to}/`                 | Same table, same mids, so a chart and the portfolio total can never disagree — ADR 0017 has the measured gap against Yahoo (7–22 bps) and why it disqualifies a market feed here. Archive starts 2002-01-02; **367 days per request** (`400` beyond, so the adapter chunks); a range with no publication is a `404`, meaning empty, not failed.                                                                         |
| NBP reference rate (ROR, DOR)   | `static.nbp.pl/dane/stopy/stopy_procentowe.xml` and `..._archiwum.xml` | No JSON API. Small XML (3 KB / 37 KB), full history to 1998, comma decimals, parsed into `index_observations`. Changes a handful of times a year. **Not** on `api.nbp.pl`, which serves only FX tables and gold — ADR 0016.                                                                                                                                                                                             |
| Polish CPI (COI, EDO, ROS, ROD) | GUS monthly CSV, `stat.gov.pl/download/.../miesieczne_wskazniki_…csv`  | 230 KB, `;`-delimited, **cp1250**, comma decimals; filter to "Analogiczny miesiąc poprzedniego roku = 100" for 540 monthly prints from 1982. Future months are blank rows, not zeroes. The **BDL API cannot serve this** — annual and quarterly only — and DBW has no CPI area at all. Verified, ADR 0016.                                                                                                              |
| Bond per-issue parameters       | obligacjeskarbowe.pl monthly offer pages (GET)                         | One GET per family, both published numbers in prose. **Current month only**: the interest tables and the emission-letter archive are POST forms behind PKO's WAF (403, confirmed with a real browser), so history comes from committed bootstrap data. ADR 0016.                                                                                                                                                        |
| Bond daily interest tables      | Bank Pekao, `pekao.com.pl/.rest/gb-interest-tables/…`                  | **Plain JSON REST, no auth, no WAF** — the same official tables, from a second emission agent. Covers ROR, DOR, TOS, COI, EDO; used to generate golden fixtures, not at runtime. `gb-emission-lists/{FAMILY}` also returns emission-letter PDFs by direct path. ADR 0016.                                                                                                                                               |

## Ticker identity

Providers disagree about symbols: `PKN` on Stooq, `PKN.WA` on Yahoo, `BTC-USD`
versus `BTCUSD`. `instrument_identifiers` maps our instrument to each provider's
symbol, so adding a provider never means renaming anything or teaching the domain
about ticker conventions.

## Cache TTLs

Prices are facts about the world, identical for every user, so one fetch serves
everybody — see ADR 0010. TTLs by granularity:

| Data                | TTL                                             |
| ------------------- | ----------------------------------------------- |
| `m15` intraday bars | 15 minutes, and only while the exchange is open |
| `h1` bars           | 1 hour while open                               |
| `d1` close          | Until the next session close                    |
| FX (NBP table A)    | Until the next business-day publication         |
| NBP reference rate  | On change — rare                                |
| PL CPI              | Monthly                                         |

Refresh is stale-while-revalidate with no scheduler; see `architecture.md`.

## The Polish data problem

The last three rows of the table above have no clean programmatic source. That
is a fact about Poland's public data, not a design choice, and it dictates the
shape of those adapters.

ADR 0016 pins down exactly how much of each is reachable, after testing rather
than assuming. Short version: the NBP rate and CPI **do** automate cleanly; bond
per-issue parameters automate for the current month only, because the interest
tables and the emission-letter archive sit behind a WAF that refuses every
non-interactive client. So tier 2 below is load-bearing for bond history, not a
convenience.

**Automation is the goal, and the design is built for it — but never in the
critical path.** Each of these sits behind a port with three tiers, tried in
order:

1. **Automated fetch and parse** from the official source, writing into the
   shared global table. This is the target for all three, and should be built as
   soon as each one is actually needed.
2. **Committed bootstrap data** in `packages/providers/src/mf/data/` for
   history — so a cold start never depends on crawling years of archive, and the
   automated fetcher only ever has to handle recent data. For bonds this is not
   a cold-start convenience but the **only** route to a past issue, since the
   archive is WAF-blocked (ADR 0016); adding an entry is a data change that gets
   reviewed like code.

   **Bond issue parameters invert tiers 1 and 2 on purpose**: a series' terms are
   fixed for its life, so a committed row is consulted before the network and a
   known series never causes a fetch. The cost is that a corrected offer page
   cannot override a stale committed row, which is why a wrong entry gets fixed
   in the file rather than waited out.

3. **Manual override in the UI**, so a parser breaking on a redesigned page
   degrades to "one value needs typing in" rather than "bond valuations are
   silently wrong".

These values change twelve times a year at most, which means the fetcher can
afford to be conservative: fetch rarely, validate hard, and **refuse to write a
value that fails a sanity check rather than guessing**. A wrong CPI number
silently mis-values every inflation-indexed bond in the system. A fetcher that
fails loudly is strictly better than a fetcher that is clever.

## Failure behaviour

The rule from `CLAUDE.md`: **a missing price is an error, never an estimate.**
Concretely, when a provider fails:

- Serve the last known value **with its timestamp visible**, so the user can see
  the number is old.
- If there is no last known value, show that the position could not be valued.
  Do not omit it from totals silently, and do not fall back to cost basis dressed
  up as market value.
- Never interpolate between known points, and never substitute a related
  instrument's price.

The failure mode being defended against is not an outage — it is a number that
looks right and is not.

## Provider quotas

Because the market-data cache is global, per-instrument fetches are already
shared across every user. Quota pressure therefore scales with the number of
_instruments_, not the number of users, which is what makes free tiers viable
for a public product. Add a per-provider token bucket in `packages/providers`
when instrument count justifies it, not before.
