# Data sources

Everything Finansify fetches from the outside world, what each source actually
offers, and how we behave when it breaks.

All of these sit behind ports defined in `packages/core/src/ports/` and are
implemented in `packages/providers`. Nothing in the domain knows any of these
names.

## The feeds

| Need                            | Source                                                                 | Reality                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global equity and ETF quotes    | `yahoo-finance2` v4                                                    | Unofficial and actively maintained, but no SLA and no terms guarantee. Server-side only — CORS and cookies make it unusable in a browser. **Keep a second implementation working**; this one can break without notice. |
| GPW quotes                      | Stooq CSV, `stooq.pl/q/d/l/?s=<sym>&i=d`                               | No real API, but stable free CSV endpoints with good GPW coverage. Yahoo's `.WA` tickers work and thin out on small caps. Also the natural fallback if Yahoo breaks.                                                   |
| FX                              | NBP Web API, `api.nbp.pl`, table A mid rates                           | Free, official, no key, HTTPS-only since August 2025. Publishes on business days only, so it needs last-business-day carry-forward. Non-PLN crosses derive through PLN.                                                |
| NBP reference rate (ROR, DOR)   | `static.nbp.pl/dane/stopy/stopy_procentowe.xml` and `..._archiwum.xml` | No JSON API. Small XML, parsed into `index_observations`. Changes a handful of times a year.                                                                                                                           |
| Polish CPI (COI, EDO, ROS, ROD) | GUS monthly release                                                    | No clean REST API. Twelve values a year.                                                                                                                                                                               |
| Bond per-issue parameters       | obligacjeskarbowe.pl monthly offer and emission-letter archive         | No API. dane.gov.pl publishes retail-bond data as a single XLS with no REST endpoint — verified, not assumed.                                                                                                          |

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

**Automation is the goal, and the design is built for it — but never in the
critical path.** Each of these sits behind a port with three tiers, tried in
order:

1. **Automated fetch and parse** from the official source, writing into the
   shared global table. This is the target for all three, and should be built as
   soon as each one is actually needed.
2. **Committed bootstrap data** in `packages/providers/src/pl/data/*.json` for
   history — so a cold start never depends on crawling years of archive, and the
   automated fetcher only ever has to handle recent data.
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
