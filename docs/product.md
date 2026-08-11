# Product

Finansify is an investment-portfolio tracker for a Polish investor.

## The four questions

Everything in the product exists to answer one of these. A feature that answers
none of them is out of scope until the list changes.

1. **What do I own?** Across every broker and every account, in one place.
2. **What is it worth right now?** In a currency I choose, with the exchange-rate
   handling correct rather than approximately correct.
3. **Where did the return actually come from?** Which positions, which lots,
   how much from price and how much from dividends and interest.
4. **How does that compare to just buying the market?** Portfolio performance
   against indices, on a basis that makes the comparison fair.

## Who uses it

Two people today. The design assumes it may become a public product, which
shapes two things and nothing else:

- **Portfolio data is isolated per user**, structurally rather than by
  discipline. See ADR 0009.
- **Market data is cached globally and shared across all users.** Prices are
  facts about the world, identical for everyone, so one fetch serves everybody.
  This also means free-tier provider quotas scale with the number of
  _instruments_, not the number of users. See ADR 0010.

Everything else — billing, roles, teams, onboarding — is deliberately absent.

## Scope

**Accounts and wrappers.** IKE, IKZE, regular brokerage, PPK. OKI arrives in
2027 and is expected to be configuration rather than code (`wrapper_rules`, see
`domain.md`). Wrappers differ in contribution limits and tax treatment, and both
are data.

**Instruments, first version.** Foreign equities and ETFs (mostly XTB), GPW
equities and ETFs (mostly Boś), and Polish retail treasury bonds. Later: metals,
crypto, and TFI funds — PPK is largely TFI, so that one is coupled to making PPK
useful.

**Brokers.** XTB and Boś (bossa) statement import, plus a generic CSV mapper and
manual entry. Manual entry is not a fallback; it is the primary path for
anything we cannot import, and it must stay pleasant to use.

**Polish retail treasury bonds** get first-class support rather than being
modelled as generic instruments: OTS, ROR, DOR, TOS, COI, ROS, EDO, ROD. No data
provider prices these, so we compute their value ourselves from the issue terms,
NBP reference rates, and CPI. This is the most bespoke part of the system and
the main reason the product is worth building at all — no off-the-shelf tracker
handles them properly.

**Analysis.** Allocation across all accounts combined (by asset class, currency,
account, wrapper, geography). Time-weighted return against benchmarks and
money-weighted return for what was actually earned. Dividend and interest income
over time, so the trend in payouts is visible and not just the totals.

## Explicitly not in scope

- **Trading.** Read-only. Finansify never places an order.
- **Advice.** It reports what happened; it does not suggest what to do.
- **Tax filing.** The schema is built so tax reporting is possible later (the
  Polish D-1 NBP rate rule is anticipated in `domain.md`), but generating filings
  is not a v1 goal.
- **Real-time streaming.** Fifteen-minute freshness is the target, not tick data.

## Principles

**Correct beats fast, and both beat clever.** A number that is silently wrong is
worse than a number that is missing, because the user cannot tell. A missing
price is an error; it is never estimated, interpolated, or substituted.

**The ledger is the product.** Prices, FX rates, and CPI can all be refetched
from the world. Transactions cannot. Everything about the design treats the
transaction log as the one irreplaceable asset and everything else as a cache.

**Nothing is precomputed in v1.** Value is derived from the ledger on read. This
keeps the system honest — there is no stored number that can drift away from the
transactions that produced it. See ADR 0003.
