# Roadmap

**This is the state file.** Update it when you finish something. Everything else in `docs/`
should stay true for months; this one moves.

Last updated: 2026-08-10

## Where we are

**Phase 0 and Phase 1 complete.** Phase 2 not started.

The repository was rebuilt from scratch on 2026-08-10. Accounts and portfolios are live:
sign in/out, create and list both, link an account into multiple portfolios, and an
audit trail on every mutation, running against a real Neon database.

## Phases

Each phase ends at a checkpoint that can be verified by hand, not by "it compiles".

### Phase 0 — Foundation ✅

- [x] pnpm workspace: `apps/web`, `packages/core`, `packages/db`
- [x] Next 16 + Tailwind v4 + shadcn/ui configured
- [x] Drizzle wired to Neon with pooler/direct split
- [x] Money, FX and valuation primitives ported, 25 tests passing
- [x] Import boundaries enforced by ESLint
- [x] Clerk session handling
- [x] CI, docs, ADRs

**Checkpoint:** `pnpm check` and `pnpm build` pass from a clean clone. ✅

### Phase 1 — Accounts and portfolios ✅

- [x] Sign in / sign out (Clerk)
- [x] Create and list portfolios and accounts, with wrappers
- [x] Link one account to multiple portfolios
- [x] Audit events written on every mutation
- [x] Apply migrations to a real Neon project, confirm app-level `user_id` filtering blocks cross-user reads

**Checkpoint:** an account in two portfolios appears once in the global view, not twice. ✅

### Phase 2 — Ledger and valuation

- [ ] Ledger tables: transactions, cash movements, fees, dividends, tax withholding
- [ ] Manual transaction entry
- [ ] FX rate stored per transaction; NBP API integration for rate lookup
- [ ] Current valuation in a chosen display currency
- [ ] Lazy compute + cache, invalidated on ledger write (ADR [0003](decisions/0003-lazy-computation.md))

**Checkpoint:** a multi-currency buy with a fee reconciles by hand, and gives the same
answer after a reload.

> Equity prices can be entered manually in this phase. Automatic price fetching is
> blocked on the provider decision below.

### Phase 3 — Polish retail bonds

Pulled ahead of import deliberately — this is the differentiating feature and it needs no
market data provider. See ADR [0005](decisions/0005-bonds-before-import.md).

- [ ] TOS and EDO: accrual, capitalization, early redemption, maturity
- [ ] COI and ROS via manual fields
- [ ] Bond cash flow schedule view

**Checkpoint:** a real TOS and a real EDO holding reconcile to the grosz against the
official redemption schedule.

### Phase 4 — XTB import

- [ ] Upload and store raw file (Supabase Storage), immutable
- [ ] Parse to normalized records; file-hash and record-hash dedupe
- [ ] Instrument matching and reconciliation review before commit
- [ ] Edit imported records; corrections survive re-import

**Checkpoint:** importing the same file twice changes nothing.

### Phase 5 — Analytics

- [ ] FIFO lot engine
- [ ] Realized and unrealized P/L
- [ ] XIRR and TWR
- [ ] Historical value series and charts

**Checkpoint:** known fixtures produce expected results at portfolio, account and
instrument level.

## Open questions

Each blocks the phase named. Resolve before starting it, not during.

| Question                                                         | Blocks                           | Notes                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Which market data provider for GPW and global equities/ETFs?** | Phase 2 (automatic pricing only) | GPW licenses its own feed. Free options are third-party freemium. Manual entry unblocks the rest of Phase 2. Write an ADR when decided. |
| Are fees capitalized into cost basis, or shown separately?       | Phase 2                          | Affects cost basis and realized P/L. Pick one and store it per account.                                                                 |
| On an FX gap, use nearest-prior silently or force confirmation?  | Phase 2                          | `domain.md` says flag as estimated; open question is whether the UI blocks on it.                                                       |

## Resolved

- Lot method scope → per-account config field. (`domain.md`)
- Portfolio aggregation → distinct-account dedupe by default. (`domain.md`)
- Background jobs → none; lazy compute. (ADR [0003](decisions/0003-lazy-computation.md))
- Bond phase order → before import. (ADR [0005](decisions/0005-bonds-before-import.md))
