# 0005 — Bonds ship before XTB import

**Status:** Accepted
**Date:** 2026-08-10

## Context

The original phase order put Polish retail bonds last, after import and analytics. That
made the first shippable product a generic portfolio tracker with an XTB importer —
something several tools already do well.

The bond handling is the part that does not exist elsewhere.

## Decision

Polish retail bonds move to **Phase 3**, ahead of XTB import (Phase 4) and analytics (Phase 5).

Two properties make this cheap rather than risky:

1. **Bonds need no market data provider.** TOS/EDO value comes from a computed accrual schedule, not a price feed — so this phase is not blocked on the one open dependency that blocks automatic equity pricing.
2. **Bonds sit on top of the ledger, which is Phase 2.** No layer is being skipped.

## Alternatives

| Option                  | Why not                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Keep bonds in Phase 6   | Safest ordering, but the differentiating feature ships last and stays untested longest |
| Bonds before the ledger | Not possible — bond cash flows are ledger events                                       |

## Consequences

- XTB import slips by roughly one phase. Manual entry covers the gap; it is a single-user MVP.
- The bond accrual engine gets written before the FIFO lot engine, so their interaction (a bond sold before maturity) surfaces in Phase 5 rather than Phase 3. Watch for it.
- We can dogfood the product on real bond holdings much earlier, which is the fastest way to find accounting errors.

## Revisit when

Phase 2 runs long and importing an XTB history becomes the faster way to get real test
data into the ledger.
