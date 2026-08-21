# 0024. Aggregated search for bankier, a dedicated use case for Catalyst bonds

**Status:** Accepted
**Date:** 2026-08-21

## Context

ADR 0022 and 0023 gave `gpw` and `bankier` a way to **price** an instrument
that already exists. Neither gave a way to **find** one in the first place —
confirmed the hard way: a real user could not add a PPK subfund or a
Catalyst-listed bond at all, because `getInstrumentSearchProvider()` only
ever returned Yahoo, and Yahoo indexes neither (verified live: nothing for a
Polish PPK subfund, nothing for a Catalyst ticker).

Two different sources, two different shapes of problem:

**bankier.pl** has a clean instrument-search API
(`api.bankier.pl/quotes/public/instrument-search/?query=`) that answers with
`funds_tfi` and `ppk` arrays, each entry carrying exactly the identifier
(`kod`/`code`) `bankierPriceProvider` already fetches prices by (Stage 4).
One identifier, two roles (find it, price it) — the same shape Yahoo already
has, so a bankier fund fits the existing `InstrumentSearchProvider` →
`selectInstrument` flow with no changes to either.

**gpwcatalyst.pl** has no search API at all — checked directly, only full
per-segment listing pages (corporate, municipal, covered, cooperative,
convertible; ~1.5 MB each, confirmed live: ~640 rows for corporate alone).
And a Catalyst bond has **two** identifiers for two **different** roles: the
ticker (`instruments.symbol`, what `gpwcatalyst.pl` and
`CatalystBondTermsResolver` answer to, ADR 0023) and the ISIN (what `gpw`'s
price quotes, `chart-json.php`, are keyed by). `InstrumentSearchProvider.
confirm()` returns exactly one `symbol`, persisted both as the instrument's
own identity and as the provider-mapping identifier by `selectInstrument` —
correct when there is one identifier, silently wrong when there are two: it
would map `gpw` to the ticker, and every later `chart-json.php` call for that
bond would ask GPW a question keyed by the wrong kind of string, forever,
until someone noticed prices never loaded and fixed the mapping by hand
(Stage 5's admin screen exists, but relying on it to make a just-added
position priceable is a bad first run, not the fix).

## Decision

**bankier gets a real `InstrumentSearchProvider`**
(`bankier/search-instruments.ts`). `search()` maps `funds_tfi` + `ppk` hits
to `fund` candidates (PPK is a tax wrapper, not a kind — both arrays become
the same `InstrumentKind`). `confirm()` re-runs the search with the
candidate's own `symbol` as the query and requires an exact `kod`/`code`
match for the name — never the candidate's own `name`, which is unverified
form data (ADR 0014's hard gate, same reasoning as Yahoo's) — then fetches
`bankier-fund-chart-data` (already built, Stage 4) for the currency, since
the search response never carries one.

**Multiple sources fan out through one aggregator, not a widened port.**
`makeAggregatingSearch` (`core/valuation/aggregate-search.ts`) takes
`readonly InstrumentSearchProvider[]`, queries every one on `search()`, merges
the hits, and dispatches `confirm()` to whichever provider actually produced
the picked candidate — itself an ordinary `InstrumentSearchProvider`, so
`makeSearchInstruments` and everything downstream of it needed zero changes.
Same choice ADR 0022 made for prices: composition over an existing port, not
a new one. Unlike `provider-chain.ts`'s fallback (first success wins, in
priority order — alternatives for the _same_ instrument), this always queries
every provider and merges — a fund bankier answers for and an ETF Yahoo
answers for are both real results for the same query, not competing answers
for one. A provider that throws contributes zero results rather than failing
the whole search, the same tolerance `fetchWithFallback` gives a failing
price provider.

**Catalyst bonds get a dedicated use case, `makeSelectCatalystBond`, that
bypasses `selectInstrument` entirely** — same shape as `select-bond.ts`'s
existing precedent for retail treasury bonds, for a different reason (that
one has no provider at all; this one has two identifiers for one provider).
It calls a new port, `CatalystBondLookup` (`core/bonds/ports.ts`):
`search(query)` for candidates, `fetchListing(ticker)` for the full record.
`makeSelectCatalystBond` writes what `confirm()`'s contract cannot: the
`Instrument` keyed by ticker, and a `symbols.save()` mapping `gpw` to the
**ISIN** explicitly — two separate identifiers, two separate writes. It also
warms `catalyst_bond_terms` with the nominal `fetchListing` already fetched,
so the position's first valuation costs no second request for data this call
already has in hand.

**`gpwCatalystBondLookup.search()` scrapes the corporate-bond listing table**
(`gpw/catalyst-bond-lookup.ts`) — walks issuer and ticker links in document
order rather than parsing `<tr>`/`<td>` structure, because the issuer cell is
`rowspan`-grouped (one cell names every bond from that issuer; a ticker with
no issuer link before it belongs to whichever issuer came last). The listing
page repeats this table 2-3 times (a hidden variant feeds an "export to
Excel" button) — `search()` dedupes by ticker. `fetchListing()` reads the
same instrument page `CatalystBondTermsProvider` already reads (ADR 0023),
now also pulling the ISIN (`id="isin" value="..."`, a hidden input) and
issuer name (`Nazwa emitenta`); `parseNominal` is exported and shared rather
than duplicated. Both fetches now go through `gpw/client.ts`'s shared
`fetchGpwCatalystPage` — extracted from `catalyst-terms-provider.ts`'s
previously-inline fetch — so a search-triggered request and a terms-resolver
request share one throttle queue against `gpwcatalyst.pl`, the same site,
rather than two independent ones.

**Search is delivered over one streaming Route Handler
(`app/api/instruments/search`), not one Server Action per source.** The first
version of this feature exposed `searchExistingAction`,
`searchYahooAction`, `searchBankierAction`, and `searchCatalystBondsAction`
as four separate Server Actions, called independently from
`<InstrumentCombobox>` so a slow source could never block a fast one.
Two problems surfaced testing it live: Next.js queues same-client Server
Action calls rather than running them concurrently, so the four calls never
actually ran in parallel — a slow one stalled every request behind it, with
no way to cancel a stale one either; and naming each source as its own
action put individual provider names (`yahoo`, `bankier`) directly in the
client component, bypassing the encapsulation `makeAggregatingSearch` exists
to provide. A plain `GET` returning a `ReadableStream` of NDJSON fixes both:
`buildInstrumentSearchTasks` (`apps/web/src/lib/instrument-search.ts`) builds
one task per source — generically, by iterating `getInstrumentSearchProviders()`
rather than naming providers — runs them concurrently with `Promise.all`, and
writes each one's `{ options: [...] }` line the moment it settles; the
client never sees a source name, only a stream of batches until it closes.
`fetch()` is ordinary HTTP, so the four sources genuinely run concurrently,
and the client aborts the previous request's stream (`AbortController`) the
instant a new query starts, instead of leaving it to finish and block the
next one.

**Corporate bonds only, for now.** Municipal, covered (`listy zastawne`),
cooperative, and convertible bonds sit on their own listing pages on
`gpwcatalyst.pl` and are not fetched — a deliberate scope cut matching what a
retail investor is overwhelmingly likely to hold, not an oversight. Extending
`search()` to the other segments is more listing pages through the same
parser, not a new design.

## Consequences

Adding a Catalyst bond now costs one extra request beyond what pricing alone
needed (`fetchListing`, during `confirm`-equivalent selection) plus the
`search()` request against the corporate-bond listing (~1.5 MB, throttled
alongside every other `gpwcatalyst.pl`/`chart-json.php` call). `search()`
only fires this for a query at least 2 characters long, matching
`makeSearchInstruments`'s own floor.

`InstrumentOption` (`apps/web/src/app/(app)/transactions/actions.ts`) gains a
third bypass variant, `catalyst_bond`, alongside `bond` — both are offered
_next to_ whatever `selectInstrument`'s flow found rather than routed through
it, and both are suppressed only when the same identifier is already an
`existing` instrument. `<InstrumentCombobox>` submits just the ticker as a
hidden field, the same shape a bond's series code already takes.

`gpwPriceProvider.capabilitiesFor` and `bankierPriceProvider.capabilitiesFor`
are unchanged — this only makes instruments reachable that ADR 0022/0023's
pricing already covered once they exist.

## Alternatives considered

**Widen `InstrumentSearchProvider.confirm()` to return more than one
identifier** (a map of provider-role → symbol), so Catalyst bonds could stay
inside the generic flow. Rejected — every other implementation (`yahoo`,
`bankier`) has exactly one identifier and would carry a field it never uses;
widening a port for one caller's edge case is the kind of interface bloat
`selectInstrument`'s existing single-`symbol` design deliberately avoids.

**Give `bankier` and Catalyst bonds each their own dedicated use case**,
skipping the aggregator entirely. Rejected for bankier specifically: it has
no dual-identifier problem, so forcing it through a bond-shaped bypass would
duplicate `selectInstrument`'s already-correct `confirm()` gate for no
reason. Kept for Catalyst bonds, where the dual-identifier problem is real.

**Fetch and cache the corporate-bond listing on a schedule**, rather than
per search call. Rejected as premature at the time — there is no scheduler
in this codebase (ADR 0014's lazy-ingestion stance) — but the "per search
call" half of that assumption was wrong: live testing put the page itself at
~2s under good conditions, but the shared 8s-timeout/3-retry budget built for
the small per-instrument pages could compound to nearly a minute on a single
slow or failing attempt against gpwcatalyst.pl, which is what actually
produced a user-visible ~50s search hang. The fix taken is narrower than a
scheduler: `gpw/catalyst-bond-lookup.ts` caches the parsed listing for 12h
(module-level TTL, same idiom as this module's own request throttle, lazily
refetched on the next search once it expires — no scheduler, no `after()`
warm-up), and `fetchGpwCorporateBondsList` uses one longer, unretried attempt
instead of the shared retry policy, so a cold cache costs one bounded wait
rather than the compounding one.
