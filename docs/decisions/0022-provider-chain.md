# 0022. A per-instrument provider chain, capabilities by kind, non-sticky fallback

**Status:** Accepted
**Date:** 2026-08-21

## Context

ADR 0014 committed to one price provider (Yahoo) because no free second
source existed with usable GPW coverage. That premise no longer holds: GPW's
own unofficial `chart-json.php` endpoint (`gpw.pl`, `gpwcatalyst.pl`) and
bankier.pl's public API both answer, verified by direct request, and between
them they cover what Yahoo does not — GPW equities and ETFs with full
history, Catalyst-listed bonds (quoted as a percentage of nominal, not
money), and TFI/PPK fund history.

The three providers do not overlap cleanly. Each answers for a different
subset of `InstrumentKind`, and even within one provider the answer differs
by kind: bankier has full history for a PPK fund and only today's spot price
for an equity or a Catalyst bond. A design that asks "which provider do we
use" as a single, global choice cannot express that — the question is really
"which provider can answer _this_ for _this kind of instrument_," asked per
instrument, per need (`history` or `spot`).

Two consequences follow directly, and they drive the whole design: a
provider must declare its capability per kind, not once; and a spot-only
provider must never be asked for history, or backfill will keep re-asking a
question that provider structurally cannot answer and `markCovered` will
record a lie.

## Decision

**A `PriceProvider` declares `capabilitiesFor(kind): { history, spot }`,
never a single global yes/no.** `fetchDailyBars` stays required in the
interface; routing checks `capabilitiesFor(kind).history` before ever calling
it, and never calls it otherwise. `fetchSpot` is optional and, for now,
unused — no usecase in this change calls it; it exists so a provider that
only answers `spot` (bankier, for most kinds) can still declare that
honestly.

**Every instrument resolves to an ordered chain, not a single symbol.**
`instrument_identifiers` gains `priority` (lower tried first), `fallback_count`
and `last_fallback_at`. `SymbolRepository.chainFor` returns the whole
ordered chain; `resolvedFor` is kept, unchanged in shape, returning the
chain's first entry, so it still answers "the provider this instrument
prefers" for a caller that only needs one.

**`packages/core/src/valuation/provider-chain.ts` is the whole routing
behaviour**, in two functions: `selectProvider(chain, registry, kind, need)`
filters a chain down to the entries capable of `need`, preserving chain
order; `fetchWithFallback(...)` walks those candidates in order, first
success wins, and reports which providers it fell back from.

**Failing over is deliberately not sticky.** Nothing reorders the chain or
remembers a failure across calls — the next refresh always starts from
`priority` order again. `fallback_count`/`last_fallback_at` exist so an
admin can _see_ a provider failing repeatedly and reorder by hand (Stage 5);
they are a counter, not a mechanism. The circuit breaker in `makeRefreshPrices`
still counts consecutive failures per instrument (the whole chain exhausted),
matching the per-instrument breaker ADR 0014 already had — not a new,
per-provider one, which would let one dead provider silently starve every
instrument behind it of a chance to try its own chain.

**`instrument_prices`' primary key gains `source`** — `(instrument_id, date,
source)`, the same shape `fx_rates` already used for the same reason (ADR
0018): two providers can hold a price for the same instrument-day and
disagree, so whichever refresh ran last must never silently overwrite the
other. Every read of `MarketPriceRepository` now names a source, mirroring
`FxRateRepository` exactly.

**Two read policies, not one, because "latest price" and "a chart" are
different problems.** The latest-price render path (`makeReadPrices`,
and `makeRefreshPrices`'s own due-check) walks an instrument's _whole_ chain
looking for whatever is actually stored, because non-sticky fallback means
the bar that landed after the last refresh could be sitting under any entry
— showing nothing when a usable value exists would be worse than "mixing."
A chart (`makeReadPriceHistory`, `makeBackfillPriceHistory`) commits to a
single, fixed source per instrument — the first chain entry capable of
`history` — and never falls back: two providers' bars stitched into one line
is exactly what "never interpolate, never substitute" (rule 7) already rules
out, and a bar written under a fallback source there would be invisible to
the chart anyway, since it only ever reads the primary.

## Consequences

This changes ADR 0014's "one provider, deliberately" — narrowly. That
decision's real content (no scheduler, lazy fetch, 15-minute TTL, resolution
gated by `confirm()`, a missing price is an error) is untouched; only the
premise "no free second source exists" is superseded, and only for Polish
assets. Yahoo remains the sole source for everything foreign — adding a
second foreign source is explicitly out of scope for this change.

Every caller of `MarketPriceRepository.latestFor`/`historyFor` now has to
say which source it means, same as `FxRateRepository` already required.
`apps/web/src/server/container.ts`'s `getPriceProvider()` becomes
`getPriceProviders(): ReadonlyMap<ProviderName, PriceProvider>` — a registry,
not a single instance — and only `yahoo` is registered as of this change;
`gpw` and `bankier` join once their adapters land.

A chain with more than one entry costs an extra request per refresh when its
primary is down — non-sticky fallback re-tries the primary every round by
design, trading a wasted request for simplicity and admin visibility over a
sticky mechanism that would need its own un-sticking logic.

`ResolvedSymbol` now carries `kind`, joined from `instruments.kind` at read
time rather than duplicated onto `instrument_identifiers` — one more column
`SymbolRepository`'s queries join in, not a new source of truth.

## Alternatives considered

**A single global `capabilities` per provider**, checked once regardless of
`InstrumentKind`. Rejected — bankier's own numbers (full history for a PPK
fund, spot-only for an equity) make this simply wrong, not just imprecise.

**Sticky fallback** — reorder the chain, or remember a failure, so a
consistently-dead primary stops being tried. Rejected for this change:
non-sticky is simpler, self-healing (a primary that recovers is used again
immediately, with no un-sticking step), and the admin-visible counter gives a
human the information a sticky mechanism would otherwise need to encode as
policy. Revisit only if the wasted-request cost above is measured to matter.

**Merge or average two providers' prices for the same instrument-day.**
Rejected outright — rule 7 (`CLAUDE.md`) is explicit that a missing price is
an error, never an estimate, and an averaged or stitched price is exactly
the kind of invented number that rule exists to prevent.

**Foreign-instrument fallback through bankier**, as a second source for
everything Yahoo already covers. Considered and deliberately deferred, not
rejected — Yahoo has no measured reliability problem for foreign assets, and
nothing in this change is blocked on adding a second source for it. The
default chain for a foreign instrument stays `yahoo` alone.
