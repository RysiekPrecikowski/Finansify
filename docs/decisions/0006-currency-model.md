# 0006. Four currencies, and the executed FX rate is stored

**Status:** Accepted
**Date:** 2026-08-11

## Context

A single transaction can involve up to four different currencies:

- the **instrument currency** — VOO trades in USD;
- the **transaction currency** — what the cash leg actually settled in, which may
  be PLN if the broker auto-converted;
- the **account currency** — the currency of the account's cash balance;
- the **presentation currency** — what the user wants to read.

These are genuinely independent. A Polish investor can hold a USD-denominated ETF
in a PLN account at a broker that settles in EUR, and want the result in PLN.

The trap is treating currency conversion as one operation with one rate source.
It is two operations with different rules, and conflating them produces P&L that
is wrong in a way nobody notices.

## Decision

**Historical legs use the rate stored on the transaction.** `fx_rate` and
`fx_rate_source` are captured at import or entry time and never recomputed.

**Presentation uses the valuation-date rate** from the `fx_rates` cache — NBP
table A mid. Changing presentation currency restates the _view_ and never the
_book_.

Cost basis, realized P&L, and fees are computed in the account currency using
stored rates. Only current market value and the totals derived from it are
converted at presentation time.

## Consequences

Cost basis matches the broker's own statement, because it uses the broker's own
rate. Brokers convert at their spread, not at the central-bank mid; reconstructing
a rate from NBP later produces a number that is close, plausible, and wrong — the
worst combination.

Switching presentation currency is a pure display operation. It cannot alter
realized P&L, which is a property worth testing explicitly (see
`docs/roadmap.md`).

The cost is that every transaction must carry a rate, including ones where it is
1.0. Imports must extract it, and when a broker's statement does not include it,
the row needs a decision: use the NBP rate for that date and mark
`fx_rate_source: 'nbp'`, or ask the user. That flag exists so the provenance of
every rate is visible rather than assumed.

Presentation conversion also depends on FX data being available for the valuation
date. NBP publishes on business days only, so the adapter must carry forward the
last business day rather than reporting a gap.

Polish tax reporting will need a third rule — the NBP rate from the business day
preceding the transaction. It is out of scope for v1, but the schema already
carries what it needs, so adding it is a calculation and not a migration.

## Alternatives considered

**One base currency, convert everything on write.** Store everything in PLN at
entry time. Simplest to query. Rejected because it destroys information: the
original amounts are gone, so the app can never show what the broker actually
reported, and a user who changes base currency has to have their history
rewritten.

**Store nothing, derive every rate from NBP on read.** No `fx_rate` column at
all. Rejected because it produces wrong cost basis for exactly the reason above,
and because it makes historical values depend on a cache that can be
incomplete.

**Two currencies only** — instrument and presentation. Rejected because it cannot
represent a broker auto-converting a trade, which is the common case at XTB and
precisely where the rate matters most.
