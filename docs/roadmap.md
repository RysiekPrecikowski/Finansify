# Roadmap

Each phase ends somewhere usable. The early ones deliberately exercise the
package boundaries while there is still little code to move.

| Phase                | Ships                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- |
| **0 — Foundations**  | Docs and ADRs · packages and ports · `Money`/`Currency`/Temporal · auth · database · CI |
| **1 — Ledger**       | Accounts, transactions, positions, FIFO lot matching, cash balances, export. No prices. |
| **1.5 — Encryption** | Encryption at rest, once there is an application to protect. See ADR 0013.              |
| **2 — Valuation**    | Instrument mapping · NBP FX · Yahoo prices · shared cache · dashboard on real data      |
| **3 — Polish bonds** | `BondTermsResolver` · family rules · accrual engine with golden tests · projections     |
| **4 — Imports**      | Blob upload · staging and review UI · XTB and Boś parsers · CSV mapper · dedup          |
| **5 — Performance**  | TWR, XIRR, benchmark overlay, versus-index view                                         |
| **6 — Income**       | Dividend and interest analytics over time, yield-on-cost                                |
| **Later**            | OKI (2027) · PPK and TFI · crypto · metals · tax reports · expenses (unscoped)          |

Phase 1 landing before any price feed is intentional: it forces the ledger and
lot matching to be correct on their own, with nothing to hide behind.

## Where we are

**Phase 0 — complete.**

- Docs and ADRs 0001–0012 · `core` and `db` packages · `Money`/`Currency`/Temporal
- App shell + dashboard on fixture data · `users` behind the provider indirection
- CI migration job + migration-drift check · Neon and Clerk provisioned · first migration applied to a real database
- `/security-review`: 2 HIGH findings (CI pwn-request, auth bypass on `.rsc`) — both fixed

**Phase 1 — complete.**

- [x] `core`: ledger vocabulary, `LedgerRepository` port, branded ids
- [x] `db`: `accounts`, `portfolios`, `instruments`, `transactions` + migration
- [x] `core`: `buildPositions`, `matchLots`, `buildCashBalances` + property tests
- [x] `db`: `ledgerRepository.forUser`, `findOrCreateInstrument`
- [x] `core`: ledger use cases — open account, record/update/soft-delete
      transaction, resolve instrument (account-ownership check and rule 6 both
      live here, so no route can skip either)
- [x] `apps/web`: composition root wired (`container.ts`), accounts screen,
      transaction entry (create/list/edit/soft-delete), positions view
- [x] CSV/JSON ledger export
- [x] `/security-review` × 2 (ledger + encryption removal; use cases +
      screens) — no HIGH or MEDIUM findings
- [x] Property testing found and fixed a `decimal.js` precision defect in
      `matchLots`

Dashboard still renders `lib/fixtures/portfolio.ts` until Phase 2 has real
prices.

**Phase 1.5 — encryption, built during Phase 1 then withdrawn before the
ledger held a row.** Added a master key, an env var, key-escrow and a
rotation problem to a product that couldn't yet record a transaction —
dependencies before features, the wrong order. ADR 0013 keeps the analysis in
full; revisit when there is data worth protecting.

**Phase 2 — in progress.**

- [x] ADR 0014 — lazy ingestion, single provider, exchange as a mandatory
      resolution coordinate (corrects `docs/data-sources.md`'s Stooq entries)
- [x] `core`: `valuation` domain — `PriceLookup`/`FxRateLookup`,
      `valuePositions`; `searchInstruments`/`selectInstrument` resolve and
      confirm an instrument at creation time
- [x] `db`: `instrument_identifiers`, `instrument_prices`, `fx_rates` +
      migration and repositories
- [x] `providers` (new package): Yahoo adapter (search, daily bars,
      throttling/429 backoff), NBP adapter (table A)
- [x] `apps/web`: `/portfolio` open positions — market value, unrealized
      P&L, PLN total, streamed via the only `<Suspense>` boundary that
      touches a provider
- [x] Instrument selection by search — local DB first, provider fallback,
      re-confirmed against a live quote before persisting (ADR 0014, revised)
- [x] ADR 0017 + a `pre-production` Neon branch — migrations rehearse there
      first; written after a partial migration wedged production for three
      hours behind a green `check`
- [ ] Dashboard on real data — still on fixtures; deferred to its own PR,
      since it touches every dashboard component
- [ ] Market calendar / per-instrument fetch lock — accepted gap, see ADR
      0014

**Phase 4 — in progress, running alongside Phase 3.** Real XTB exports became
available during import planning, so that work went first; the two phases ran
in parallel, which is why the migration and ADR numbering interleaves.

- [x] ADR 0015 — the import boundary: `StatementParser`'s shape,
      sub-accounts/eWallet declined (verified against a real export),
      `external_id` as the only dedup signal that survives a re-export
- [x] `core`: `StatementParser` port — `RawFile`, `ParsedRow`,
      `ParsedStatement`, three-state `Confidence`
- [x] `db`: `import_batches` / `import_rows` + migration;
      `transactions.import_batch_id` finally has its FK
- [x] `importers` (new package): `XtbStatementParser` — comment-grammar
      parsing, FX-rate inference by median ratio, reconciliation warnings
      (never blocking), a synthetic fixture covering every case found in real
      exports
- [x] `FileStore` Blob adapter + upload
- [x] Instrument-resolution UI — auto-match by `(symbol, exchange)`,
      bulk-confirm, manual fallback; every mapping stays editable until the
      batch is accepted
- [x] Import use case — `acceptImportRow` dedups on
      `(account_id, external_id)`; an unedited match refreshes in place via
      `refreshImportedTransaction`, making repeated re-imports idempotent; an
      edited match settles as `duplicate` with a reason
- [x] Import review UI — `/import/[batchId]/review`, per-row accept /
      reject / edit-and-accept, bilingual, linked from `/more`

Boś stays blocked — no real exported statement examined yet.

**Phase 3 — in progress.**

- [x] ADR 0016 — what bond reference data is actually reachable (corrects
      `docs/data-sources.md`'s CPI and NBP rows)
- [x] `core`: family rules for all eight issued families, versioned and
      effective-dated, early-redemption fees per family's own offer page (the
      widely-repeated 0.70/2.00 pairing is wrong since 2024-09-01)
- [x] `core`: `accrueBond` — golden-tested to the grosz against the
      Ministry's own ROR0827 table; spec and fixtures written first, handed
      to a separate agent (rule 16)
- [x] `core`: `withholdingOn` — the 19% kept out of the engine (IKE/IKZE are
      exempt; the rate belongs to the wrapper)
- [x] `db`: `bond_series_terms`, `index_observations` + migration
- [x] Golden tables for 5 of 8 families via Pekao's public REST API — 1162
      published day-values reproduced to the grosz
- [x] Multi-period golden tables — 1828 more day-values across 22 resets;
      found and fixed a compounding rounding error in capitalization
- [x] ADR 0018 — published tables become the value **source**, not just a
      test; `accrueBond` is the fallback for unpublished families/periods
- [x] `providers`: `pekaoInterestTableProvider`, NBP reference rate (current
      + archive to 1998), GUS CPI, MF offer pages
- [x] `db`: `bond_interest_tables` + migration
- [x] `BondTermsResolver` wired; bond position entry + per-lot valuation
      (interest periods run from each purchase's own settlement date)
- [x] Bond projections — `projectBondCashFlows`, `projectBondValue`,
      `projectEarlyRedemption`, each carrying a `ProjectionBasis` (arithmetic
      or last published index — no forecasting)
- [x] `wrapper_rules` in `core` — IKE/IKZE room and limits 2020–2026,
      KNF-sourced, IKZE's two 2021 caps handled explicitly
- [ ] OTS/ROS/ROD — no published daily table to test against (OTS pays one
      sum at redemption; ROS/ROD are PKO-only, WAF-blocked)
- [ ] Bonds on the dashboard — blocked on "Dashboard on real data" above
- [ ] `wrapper_rules` as a table and a screen — figures live in `core`,
      nothing persists or shows them yet

### Phase 2 — Valuation

Turns a correct ledger into a portfolio worth looking at. ADR 0014 revised
this phase's shape after real requests against Yahoo and Stooq: no scheduler
(a `<Suspense>` boundary replaces `after()`), one provider rather than
Yahoo-primary/Stooq-fallback (Stooq is now behind a proof-of-work anti-bot
gate), and exchange (MIC) as a mandatory resolution coordinate rather than
ISIN.

- `instrument_identifiers` — provider ticker mapping, so `PKN.WA` vs `PKN` vs
  `BTC-USD` never reaches the domain.
- `PriceProvider`: Yahoo (`yahoo-finance2`), the only free source with working
  GPW and global coverage. `FxRateProvider` against NBP table A.
- The shared cache (`instrument_prices`, `fx_rates`), lazily refreshed inside
  a `<Suspense>` boundary — no scheduler, no market calendar; a fixed 15-minute
  TTL is the whole freshness rule for now.
- Dashboard on real data: headline, hero chart, allocation. The fixture dies here.

Depends on Phase 1's positions. Blocked on nothing external.

### Phase 3 — Polish bonds

The most bespoke code in the project, because no provider prices these.

- Family rules for OTS/ROR/DOR/TOS/COI/ROS/EDO/ROD as versioned config.
- `BondTermsResolver`: decompose a series code, resolve per-issue parameters,
  cache in `bond_series_terms` (ADR 0011).
- `accrueBond()` — the accrual engine, validated to the grosz against the
  official published interest tables before any bond value reaches a user.
- Forward cash-flow schedule and redemption-value projection, labelled as
  projections and never with the certainty of a current valuation.
- `wrapper_rules` — IKE/IKZE limits per year, so adding OKI in 2027 is rows.

### Phase 4 — Imports

- Raw files to Vercel Blob behind the `FileStore` port, never the database.
- `import_batches` / `import_rows` staging plus a review UI.
- `StatementParser` implementations for XTB and Boś, and a generic CSV mapper
  driven by column-mapping profiles rather than fixed offsets.
- Dedup on `external_id`; `edited_after_import` surfaces a conflict instead of
  overwriting a hand correction.

**XTB unblocked** — real exports were examined during planning;
`XtbStatementParser` is built and tested against a synthetic fixture derived
from them. **Boś stays blocked** — no real exported statement examined yet,
and a profile built from guesses is worse than no profile.

### Phase 5 — Performance

TWR (neutralizes deposits, so it is the only fair benchmark comparison) and
XIRR (what the investor actually earned). Benchmarks are ordinary instruments
with a price series, so adding one is configuration.

### Phase 6 — Income

Dividends, coupons and interest folded into monthly/quarterly/yearly buckets,
per instrument and in aggregate, with yield-on-cost and a year-over-year
overlay. A new income type is one enum member and one fold case.

## Data protection

This is a private financial ledger for two people.

- **In transit and at rest, by the provider.** TLS everywhere; Neon encrypts
  storage. Already true, nothing to build.
- **Application-level encryption — built, then withdrawn (Phase 1.5).**
  Amounts are plain `NUMERIC(28, 10)` today. `/security-review` over the
  removal found no HIGH/MEDIUM issues. ADR 0013 keeps the full analysis
  (envelope design, AAD binding, why ciphertext can't live in `NUMERIC`, and
  the honest limit that no web app protects one admin from another) — pick it
  up when there's an application worth protecting.
- **In the meantime: a database dump reveals every amount.** `instrument_id`
  and the global `instruments` table were never going to be encrypted either
  — positions can't be built without filtering on them — so even the
  withdrawn design leaked which instruments a user holds. Hiding portfolio
  composition, if that's ever a goal, is a separate decision.
- **Backups — the known gap.** Neon's PITR and branching only cover an
  accidental bad write; the copy shares an account, provider and billing
  relationship with the original. An independent copy — scheduled `pg_dump`
  over the unpooled connection, encrypted with our own key, pushed to a
  different provider under a different account — is **not built**. Needs a
  scheduler (`architecture.md`'s "no cron" rule is about cache freshness, not
  this) and its own ADR note; GitHub Actions is the natural host. A backup
  that has never been restored is not a backup — the restore procedure gets
  written and executed, not just described.
- **Export — Phase 1, done.** CSV and JSON of the full ledger: the
  user-controlled copy, and the anti-lock-in property the rest of the
  architecture already argues for.
- **Cold starts accepted.** Neon suspends on the current plan; masked with
  caching and honest loading states rather than paid away.

## Deployment risk, before real data lands

- ~~A migration first meets a real database on merge to `main`.~~ **Closed** —
  the Neon-Managed integration creates a `preview/<git-branch>` database per
  preview deployment, so a migration rehearses on the PR first. Costs a
  branch budget of ten on the free tier, kept by
  `.github/workflows/neon-cleanup.yml` (`docs/deployment.md`, "The Neon
  branch budget").
- **No down-migrations.** `drizzle-kit` applies forward only. Recovery from a
  bad migration is a restore, which makes the off-provider backup above
  load-bearing rather than nice to have.

## Verification

**Every phase** — `pnpm check`; `core` tested against in-memory port fakes with
no database and no network.

**Phase 1** — property tests for lot matching: selling everything returns cost
basis to exactly zero, and FIFO agrees with specific-lot selection when lots are
chosen in order. A two-user test proving neither can reach the other's rows.

**Phase 2** — multi-currency round trip: PLN → EUR → PLN must be identical, and
changing presentation currency must never alter realized P&L.

**Phase 3** — golden tests against the official published interest tables. The
engine reproduces them to the grosz before any bond value reaches a user.

**Phase 4** — import idempotency: the same statement twice produces zero new
transactions; an edited imported row re-imports as a conflict, not an overwrite.

**Once the dashboard is on real data**

- Drive it in a browser: seed a portfolio, check the headline against a
  hand-computed figure, switch presentation currency, resize to 375 px.
- **Verify the private-cache boundary.** Sign in as A, load the dashboard, sign
  in as B, confirm B sees nothing of A's. ADR 0009 left no database-level
  backstop, so this deserves a test rather than an assumption.
- Confirm sharing works the other way: two users holding the same instrument
  trigger exactly one upstream fetch.

**Before the first real deployment** — the migration applies cleanly to a fresh
branch; `vercel env pull` produces a working `.env.local`; with the price
adapter forced to throw, the dashboard shows stale-with-timestamp rather than an
error page or, far worse, a silently wrong number.

## Open questions

1. **Boś export format.** Resolved for XTB — `XtbStatementParser` exists,
   built from real files (see "Where we are", Phase 4). Boś still needs a real
   exported statement before its parser can be more than a guess.
2. **Benchmark set.** WIG, an accumulating world ETF and the S&P 500 are
   proposed; each becomes a tracked instrument with its own price history.
3. **KMS choice and key scheme** — see Data protection.

## Feature backlog

Not yet assigned a phase. Pull one in once scoped rather than leaving it
implicit.

**Off-provider backups** — see Data protection. The highest-value item here.

**Bond forward projection (Phase 3)** — cash-flow schedule for a held series;
redemption value at a user-chosen future date; early-redemption value across a
date range rather than only as of today.

**Splits** — `split` exists in the transaction enum and the position engine
rejects it explicitly rather than computing a wrong basis quietly. Needs
ratio handling, fractional results, and application only to lots opened before
the split date.

**Portfolio management UI** — the tables and a default portfolio exist; grouping
accounts into several portfolios has no screen yet, and earns one when there is
a reason to group them differently.

**Expense tracking (unscoped)** — not in `product.md`. Decide first whether it
extends the ledger or is a separate table, since that moves `domain.md`'s
"ledger is the product" boundary. Then: manual recurring and one-off entry,
monthly/yearly view alongside income, and whether expenses touch XIRR at all.
