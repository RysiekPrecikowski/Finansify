# Roadmap

Each phase ends somewhere usable, and the early ones deliberately exercise the
package boundaries while there is still little code to move.

| Phase                | Deliverable                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundations**  | Docs and ADRs · package skeleton with ports · `Money` / `Currency` / Temporal primitives with tests · `.env.example` · `vercel.ts` · database and auth provisioned · `users` with the provider indirection |
| **1 — Ledger**       | Accounts, portfolios, manual transaction entry, position building, FIFO lot matching. No prices yet — but cost basis is already correct.                                                                   |
| **2 — Valuation**    | Instruments and identifier mapping · NBP FX · Yahoo and Stooq price feeds · the shared cache with TTLs and a market calendar · dashboard headline, hero chart, allocation                                  |
| **3 — Polish bonds** | `BondTermsResolver` with lazy auto-population · family rules · the accrual engine with golden tests · bonds on the dashboard · forward cash-flow schedule and redemption-value projection                                                                               |
| **4 — Imports**      | Blob upload · import staging and review UI · XTB parser · Boś/bossa parser · generic CSV mapper · dedup by `external_id`                                                                                   |
| **5 — Performance**  | TWR, XIRR, benchmark overlay, the versus-index view                                                                                                                                                        |
| **6 — Income**       | Dividend and interest analytics over time, yield-on-cost                                                                                                                                                   |
| **Later**            | OKI (2027) · PPK and TFI · crypto · metals · tax reports · optional daily snapshots via cron · expense/budget tracking (unscoped, see Feature backlog)                                                                                                               |

Phase 1 landing before any price feed exists is intentional: it forces the ledger
and lot matching to be correct on their own, with nothing to hide behind.

## Verification

**Every phase**

- `pnpm check` — build, lint, typecheck, test, format.
- `core` tested against in-memory port fakes. No database, no network.
- Property-based tests for lot matching: selling everything always returns cost
  basis to zero; FIFO and specific-lot agree when lots are selected in order.
- Multi-currency round-trip: a portfolio valued in PLN, then EUR, then back to
  PLN must be identical, and changing presentation currency must never alter
  realized P&L.
- Import idempotency: importing the same statement twice produces zero new
  transactions; editing an imported row and then re-importing flags a conflict
  rather than overwriting.

**Phase 3 specifically** — golden tests for the bond engine against the official
published interest tables. The engine must reproduce them to the grosz before any
bond value reaches a user.

**Once the dashboard exists**

- Drive the real app in a browser: seed a portfolio, check the headline against a
  hand-computed figure, switch presentation currency, toggle the benchmark,
  resize to 375 px and confirm the mobile layout and bottom nav.
- **Verify the private-cache boundary explicitly.** Sign in as user A, load the
  dashboard, sign in as user B, confirm B sees nothing of A's. This is a failure
  mode that deserves a test rather than an assumption.
- Confirm sharing works the other way: two users holding the same instrument
  trigger exactly one upstream fetch.

**Before the first real deployment**

- The migration applies cleanly on a fresh database branch.
- `vercel env pull` produces a working `.env.local` with no manual renaming.
- Provider failure is graceful: with the Yahoo adapter forced to throw, the
  dashboard shows stale-with-timestamp rather than an error page or — much worse
  — a silently wrong number.

## Open questions

1. **Database engine.** Neon versus Turso, still undecided. ADR 0008 holds the
   full comparison and the recommendation. It blocks neither Phase 0 nor Phase 1,
   since `core` is engine-agnostic and `packages/db` is a thin implementation of
   interfaces defined elsewhere.
2. **XTB and Boś export formats.** The parsers need real files exported from real
   accounts before Phase 4. The importer is deliberately profile-and-column-mapping
   rather than hardcoded offsets, so a format change is a config edit — but the
   initial profiles need samples, not guesses.
3. **Benchmark set.** WIG, an accumulating world ETF, and the S&P 500 are
   proposed. Worth confirming which comparisons actually matter, since each one
   becomes a tracked instrument with its own price history.

## Feature backlog

Concrete features not yet assigned a checkpoint above. Pull into a phase once
scoped rather than left implicit.

### Bond forward projection (Phase 3)

- [ ] Cash-flow schedule view: full timeline of expected coupons,
      capitalizations, and the redemption payout for a held series, derived
      from the resolved `BondTerms` (ADR 0011) — not just the current-day
      accrued value `accrueBond()` already produces.
- [ ] Redemption-value projection: value at a future date chosen by the user
      (next coupon, maturity, or arbitrary date), using family rules where
      already fixed and the latest known index observation where not —
      clearly labeled as a projection, never presented with the certainty of
      a current valuation (`domain.md` principle: no number is silently
      estimated).
- [ ] Early-redemption value across a date range, not just "as of today".

### Expense tracking (unscoped — needs a product decision first)

Not currently in `product.md` scope. Before any implementation: decide
whether this extends the ledger (`transactions` gets non-investment types) or
is a separate `expenses` table, since that changes `domain.md`'s "ledger is
the product" boundary.

- [ ] Manual entry of recurring and one-off expenses, categorized
- [ ] Monthly/yearly expense view alongside portfolio income — net cash flow,
      not just investment return
- [ ] Decide whether expenses count toward XIRR / money-weighted return, or
      stay entirely separate from performance metrics
