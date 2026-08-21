# 0023. Catalyst bonds are a new `InstrumentKind`, valued by quote × nominal

**Status:** Accepted
**Date:** 2026-08-21

## Context

ADR 0022 added `gpw` as a price provider and deferred `bond` capability on
purpose: `chart-json.php` answers for a Catalyst-listed corporate/municipal
bond exactly as it does for an equity, but the number it returns — verified
live against a real bond, `PLGHLMC00602` (Ghelamco `GHE0128`), 78.5 on one
session — was assumed to need a representation `PriceBar.close: Money` did
not have. That assumption does not survive contact with the domain: a bond
price convention already expresses "money per 100 nominal" as money, in the
bond's own currency — the same 78.5 was independently reported in the press as
"59.99% of nominal" months earlier, same unit, same scale. `PriceBar` needed
nothing new. What was actually missing was a source for **nominal value** and
the one multiplication that turns a quote into a market value per bond.

The deeper issue is that `bond` (the `InstrumentKind`) already means something
specific and incompatible: a Polish **retail treasury** bond, subscribed and
redeemed through the Ministry, never traded, valued by `accrueBond`'s accrual
engine against published interest tables (ADR 0011, ADR 0019). `parseSeriesCode`
is a closed match against eight known families (OTS/ROR/DOR/TOS/COI/ROS/EDO/ROD);
anything else throws. A Catalyst bond is a different product wearing a similar
name — continuously traded on an exchange, market-priced, no Ministry table,
often WIBOR-floating — genuinely closer to "an equity with an unusual price
unit" than to a retail bond. Routing it through the accrual engine, or teaching
`parseSeriesCode` to fall through to a market-quote path on a family it does
not recognize, would blur two domain objects that behave nothing alike.

Nominal value turned out to be automatable, not manual. `gpwcatalyst.pl`'s own
instrument page (`/o-instrumentach-instrument?nazwa=<ticker>`) publishes it in
a structured table row (`Wartość nominalna (PLN): 100,00`), alongside the
issuer, maturity date, and the bond's real ISIN — confirmed live for GHE0128.
It answers by **ticker** (`nazwa=GHE0128`), not ISIN — `chart-json.php` answers
by ISIN instead. These are two different identifiers for two different GPW
endpoints, not an inconsistency to resolve.

## Decision

**`catalyst_bond` is a new `InstrumentKind`, distinct from `bond`.** `bond`
stays retail-treasury-only, untouched. Splitting the kind — rather than
branching on the symbol's shape inside one `bond` kind — is what lets
`buildPositions` and the valuation pipeline route each to its own path
without either accidentally falling through to the other's, and keeps
`parseSeriesCode`'s eight-family exhaustiveness exactly as closed as it was.

**A Catalyst bond trades like a security, not like a treasury subscription.**
Transactions use the existing `buy`/`sell` types — no new `TransactionType`,
no change to `buildPositions` (already instrument-kind-agnostic) or
`transactionTypes`. Retail-only `bond_purchase`/`bond_redemption`/
`bond_early_redemption` are left exactly as they were, for retail bonds only.

**Nominal value is resolved lazily and cached, mirroring ADR 0011.**
`CatalystBondTermsProvider.fetchTerms(symbol)` fetches from
`gpwcatalyst.pl`, keyed by the Catalyst ticker (`instruments.symbol` for a
`catalyst_bond` — no second identifier column). `catalyst_bond_terms` is the
global cache table, keyed by `symbol`. Simpler than `bond_series_terms`: a
Catalyst issue's nominal is fixed for its life and carries no purchase-date
composition, so a cache hit is the answer itself — `CatalystBondTermsResolver`
has no per-lot step the way `BondTermsResolver` does.

**The market value formula is one multiplication, done in `core`:**
`valueCatalystBondQuote(quote: Money, nominal: Money): Money` returns
`quote × (nominal / 100)`. Pure, currency-checked, tested against real
numbers (a 100 PLN nominal bond quoted at 78.5 is worth 78.50 PLN; a 1000 PLN
nominal bond at the same quote is worth 785.00 PLN).

**The web layer adjusts an existing `PriceLookup` rather than synthesizing
one.** Unlike a retail bond (which has no market price at all, so
`bondPriceLookups` invents a `PriceLookup` from the accrual engine's own
number), a Catalyst bond is genuinely quoted — `gpw` is already in the
provider chain and its raw quote already flows through the normal
`readPrices`/`refreshPrices` pipeline, with the normal fresh/stale/
never-fetched/unmapped states. `catalystBondPriceLookups` (a sibling to
`bondPriceLookups`, `apps/web/src/server/catalyst-bond-valuation.ts`) takes
that raw lookup, resolves nominal, and rescales `close` — leaving
`unavailable` untouched, since there is nothing to scale. `valuePositions`
itself needed no change: every kind still flows through the one generic
`price × quantity` path.

**The hero chart is excluded for now, deliberately, not silently wrong.**
`readPriceHistory` would hand back the raw unscaled quote for a whole date
range, and there is no history-range equivalent of `valueCatalystBondQuote`
yet — showing that number on a chart is exactly the "plausible-looking wrong
number" rule 7 exists to prevent. `catalyst_bond` positions are excluded from
`value-series.ts`'s quoted set, the same way retail `bond` already is: a real
gap (no chart) rather than a wrong line.

## Consequences

`/portfolio`'s position table and total correctly value a `catalyst_bond`
holding the moment one exists; its instrument-detail hero chart does not, yet.

There is no instrument-creation/search flow in this change. `instruments.symbol`
must be the Catalyst ticker and `instrument_identifiers` must carry a `gpw`
row keyed by the real ISIN for a `catalyst_bond` instrument to be priced at
all — today that means a manual insert. `gpwcatalyst.pl`'s page already
carries everything a proper selection flow would need in one request (ticker,
ISIN, nominal, issuer, maturity), so building one later is not blocked on any
further discovery — it is Stage 5's "admin UI for instrument-provider
mappings" scope, or a dedicated selection use case, not this change's.

`CatalystBondTermsRepository`/`gpwCatalystBondTermsProvider` only ever store
`nominal`. Maturity, issuer, and coupon mechanism are visible on the same
`gpwcatalyst.pl` page and were deliberately not captured — nothing in this
change reads them, and a column nothing reads is exactly the premature
generality `CLAUDE.md` warns against.

`gpwCatalystBondTermsProvider` regexes the raw markup rather than flattening
it to text first (the pattern `mf/bond-issue-provider.ts` uses) — the
`</td><td>` boundary pins the label to _its_ value, where flattening would
blur it into the next cell's. An unrecognised ticker's "Brak danych" page has
no matching row at all, so the same regex-miss-is-`null` contract as the `mf`
provider holds without a separate not-found branch.

## Alternatives considered

**Reuse the existing `bond` kind**, falling through to a market-quote path
when `parseSeriesCode` fails to match a known family. Rejected — the user's
call, made explicit: this blurs two domain objects that behave nothing alike
(subscribed-and-redeemed vs. continuously traded) under one kind, and every
place that already branches on `kind === 'bond'` would need a second,
implicit branch on "did the series code parse" instead of a clean kind check.

**A `bond_purchase`/`bond_redemption`-shaped transaction model for Catalyst
bonds**, matching retail bonds. Rejected — a Catalyst bond is bought and sold
on a continuous market like any other security; forcing it through
subscription/redemption semantics it does not have would be modelling the
wrong thing to stay consistent with a different product's name.

**Store the raw percent-of-nominal number with a new `PriceBar` shape** (a
unit flag, or a separate table). Rejected once the live quote was checked
against an independent source: the number already is money (per 100
nominal), so a new representation would solve a problem that does not exist,
at the cost of every existing `PriceBar`/`MarketPriceRepository` caller having
to handle a unit it will never see.

**Build instrument creation for Catalyst bonds in this change.** Considered
and deliberately deferred, not rejected — `gpwcatalyst.pl` has everything a
ticker-in, live-confirm-then-persist flow would need, so nothing here blocks
it. This change is scoped to valuation, matching the ticket; creation is
explicit follow-up work, not a hidden gap.
