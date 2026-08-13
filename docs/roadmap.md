# Roadmap

Each phase ends somewhere usable. The early ones deliberately exercise the
package boundaries while there is still little code to move.

| Phase                | Ships                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **0 — Foundations**  | Docs and ADRs · packages and ports · `Money`/`Currency`/Temporal · auth · database · CI |
| **1 — Ledger**       | Accounts, transactions, positions, FIFO lot matching, cash balances, export. No prices. |
| **1.5 — Encryption** | Encryption at rest, once there is an application to protect. See ADR 0013.              |
| **2 — Valuation**    | Instrument mapping · NBP FX · Yahoo and Stooq · shared cache · dashboard on real data   |
| **3 — Polish bonds** | `BondTermsResolver` · family rules · accrual engine with golden tests · projections     |
| **4 — Imports**      | Blob upload · staging and review UI · XTB and Boś parsers · CSV mapper · dedup          |
| **5 — Performance**  | TWR, XIRR, benchmark overlay, versus-index view                                         |
| **6 — Income**       | Dividend and interest analytics over time, yield-on-cost                                |
| **Later**            | OKI (2027) · PPK and TFI · crypto · metals · tax reports · expenses (unscoped)          |

Phase 1 landing before any price feed is intentional: it forces the ledger and
lot matching to be correct on their own, with nothing to hide behind.

## Where we are

**Phase 0 — complete.** Docs and ADRs 0001–0012, `core` and `db` packages, the
money and time primitives, app shell and dashboard on fixture data, `users`
behind the provider indirection, the CI migration job and its migration-drift
check, Neon and Clerk provisioned, and the first migration applied to a real
database. Two HIGH findings from `/security-review` (a CI pwn-request, an auth
bypass on `.rsc`) found and fixed.

**Phase 1 — in progress.**

- [x] `core`: ledger vocabulary, `LedgerRepository` port, branded ids
- [x] `db`: `accounts`, `portfolios`, `instruments`, `transactions` + migration
- [x] `core`: `buildPositions`, `matchLots`, `buildCashBalances` + property tests
- [x] `db`: `ledgerRepository.forUser`, `findOrCreateInstrument`
- [x] `core`: ledger use cases — open an account, record / update / soft-delete a
      transaction, resolve an instrument; the account-ownership check and rule 6
      both live here, so no route can skip either
- [x] `/security-review` over the ledger and the encryption removal — no HIGH or
      MEDIUM findings; the per-user scoping ADR 0009 depends on survived the
      rewrite intact
- [x] `apps/web`: wire the composition root — `container.ts` exports
      `getInstruments()` and `scopedLedgerFor(userId)`
- [ ] `apps/web`: transaction entry
- [ ] `apps/web`: positions view
- [ ] CSV/JSON ledger export

**Nothing in Phase 1 is reachable from the running app.** `/transactions` and
`/portfolio` are placeholders, and the dashboard still renders
`lib/fixtures/portfolio.ts`. The data layer is complete and tested; the
composition root has never been wired to it. Everything left in Phase 1 is that
wiring — and it is the only work between here and entering a real transaction.

**Phase 1.5 — encryption.** Built during Phase 1 and then **removed before the
ledger held a row**: it added a master key, an environment variable, a
key-escrow procedure and a rotation problem to a product that could not yet
record a transaction. Dependencies before features is the wrong order, and this
is the clearest example of it in the project so far.

ADR 0013's analysis is kept in full — the envelope design, the AAD binding, why
amounts cannot stay `NUMERIC`, and the honest limit that no web application
protects one administrator from another. Revisit when there is an application
to protect.

Tick a box in the same change that finishes the work. An unticked box for
shipped work is how this section stops being trusted.

### What Phase 1 added, and what it took back out

Worth recording once, because the shape of it is the lesson rather than the
detail.

**Added and kept:** the ledger vocabulary and `LedgerRepository` port; the
position engine (`buildPositions`, `matchLots` across FIFO/LIFO/average/
specific, `buildCashBalances`) with property tests for the two invariants this
document names; four tables and their migrations; a user-scoped persistence
adapter; a migration-drift check in CI. A `decimal.js` precision defect —
arithmetic running at fewer significant digits than the column storing it —
found by property testing and fixed.

**Added and then removed:** application-level encryption. AES-256-GCM row
payloads, a per-user data key, an env-held master key, key escrow, and a
rotation problem. None of it was ever wired to a code path, so nothing was
lost — but it consumed most of a phase that had not yet shipped a screen.

**The rule that came out of it:** features before dependencies. A security
control that protects data the product cannot yet store is not protection, it
is scope. The analysis keeps, the implementation waits.

Phase 2 onward is features. The next thing that ships is a form that writes a
transaction.

## What the upcoming phases contain

### Phase 2 — Valuation

Turns a correct ledger into a portfolio worth looking at.

- `instrument_identifiers` — provider ticker mapping, so `PKN.WA` vs `PKN` vs
  `BTC-USD` never reaches the domain.
- `PriceFeed` adapters: Yahoo primary, Stooq fallback for GPW. `FxRateFeed`
  against NBP table A.
- The shared cache (`prices`, `fx_rates`) with per-source TTLs, plus a market
  calendar so we neither refetch all weekend nor label Friday's close as live.
- Background refresh with `after()`; a per-instrument fetch guard against a
  thundering herd.
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

**Blocked**: needs real exported statements from real accounts. Profiles built
from guesses are worse than no profiles.

### Phase 5 — Performance

TWR (neutralizes deposits, so it is the only fair benchmark comparison) and
XIRR (what the investor actually earned). Benchmarks are ordinary instruments
with a price series, so adding one is configuration.

### Phase 6 — Income

Dividends, coupons and interest folded into monthly/quarterly/yearly buckets,
per instrument and in aggregate, with yield-on-cost and a year-over-year
overlay. A new income type is one enum member and one fold case.

## Data protection

This is a private financial ledger for two people. What is decided, and what is
not yet.

**In transit and at rest, by the provider.** TLS everywhere; Neon encrypts
storage. Already true, nothing to build.

**Application-level encryption — built, then withdrawn. Phase 1.5.** Amounts
are plain `NUMERIC(28, 10)` columns today. `/security-review` over the removal
found no HIGH or MEDIUM issues: nothing was ever wired, so no data became
unreadable and no key was orphaned, and the per-user query scoping ADR 0009
depends on came through the rewrite intact. The encrypted-payload design was
implemented during Phase 1 and removed before the ledger held a single row: it
added a master key, an environment variable, a key-escrow procedure and a
rotation problem to a product that could not yet record a transaction.
Dependencies before features is the wrong order.

ADR 0013 is kept in full rather than deleted. Its analysis holds — the envelope
that makes re-keying cheap, the AAD binding that stops a ciphertext being
replayed onto another row, why ciphertext cannot live in a `NUMERIC` column,
and the limit that no web application protects one administrator from another.
Pick it up when there is an application worth protecting.

What that means in the meantime, stated plainly so nobody assumes otherwise:
**a database dump reveals every amount.** Provider-level encryption and TLS
still apply, so this is a question of who can read the database, not of traffic
on the wire.

One thing worth knowing before that work restarts: `instrument_id` and the
global `instruments` table were never going to be encrypted, because positions
cannot be built without filtering on them. So even the withdrawn design leaked
_which_ instruments a user holds and how often they trade — only the amounts
were hidden. If hiding portfolio composition is also a goal, that is a
different design and a separate decision.

**Backups — the known gap.** Neon's PITR and branching cover an accidental bad
write, and that is all they cover: the copy shares an account, a provider and a
billing relationship with the original. Losing the Neon account loses both.

An independent copy — scheduled `pg_dump` over the unpooled connection,
encrypted with our own key, pushed to a different provider under a different
account — is **not built**. It needs a scheduler, which `architecture.md`'s
"no cron" rule does not cover (that rule is about cache freshness), so it needs
its own ADR note. GitHub Actions is the natural host: already wired, already
holds secrets, runs outside Vercel.

A backup that has never been restored is not a backup. The restore procedure
gets written and executed, not just described.

**Export — Phase 1.** CSV and JSON of the full ledger, as soon as the ledger
exists. It is the user-controlled copy, and it is the anti-lock-in property the
rest of the architecture already argues for.

**Cold starts accepted.** Neon suspends on the current plan, so the first query
after idle pays for the wake-up. Masked with caching and honest loading states
rather than paid away.

## Deployment risk, before real data lands

Two gaps in `docs/deployment.md` that are cheap now and expensive later. Both
should close before the ledger holds anything.

**A migration first meets a real database on merge to `main`.** Preview
deployments share whatever `DATABASE_URL` the Vercel project has, so the
per-PR database branch ADR 0008 leans on is _not wired_. Today that is
harmless — the ledger tables are empty and every migration so far has been a
clean `CREATE`. The first `ALTER` against real rows is the one that will hurt,
and there is no rehearsal step between writing it and production.

**No down-migrations.** `drizzle-kit` applies forward only. Recovery from a bad
migration is a restore, which makes the off-provider backup above load-bearing
rather than nice to have.

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

1. **XTB and Boś export formats.** Parsers need real files before Phase 4.
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
