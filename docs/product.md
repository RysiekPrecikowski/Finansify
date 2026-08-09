# Product

A portfolio tracker for Polish investors that gets the accounting right.

Existing tools either ignore Polish instruments (retail government bonds, GPW listings,
IKE/IKZE wrappers) or hide their arithmetic. Finansify derives every number from an
auditable transaction ledger, so any figure on screen can be traced to the events that produced it.

## Who it is for

Two people, to start: us. A Polish retail investor holding a mix of GPW and global
equities/ETFs, retail government bonds, across taxable and tax-wrapped accounts,
with an XTB account to import from.

## What makes it different

1. **Polish retail bonds are modelled properly** — TOS and EDO with real accrual, capitalization and redemption behaviour, not a manually-updated cash value.
2. **Explicit, auditable FX** — every conversion stores the rate it used and when.
3. **Replayable imports** — re-importing the same file never double-counts, and your corrections survive.

## In scope for MVP

- Web only, single user
- Manual transaction entry and XTB file import
- Polish + global stocks and ETFs
- Polish retail bonds: TOS and EDO exact; COI and ROS via manual fields
- Portfolios as reporting groups over accounts; account wrappers (Taxable, IKE, IKZE, PPK)
- FIFO cost basis, realized/unrealized P/L, XIRR, TWR
- Multi-currency with PLN as the default display currency

## Explicitly out of scope

Named so nobody rebuilds the case for them mid-sprint:

| Not doing                          | Why                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Tax engine / filing                | Enormous surface, changes yearly, not needed to track a portfolio               |
| Multi-user, sharing, collaboration | Single user is the actual requirement                                           |
| Native mobile app                  | Nothing schedules it. See ADR [0002](decisions/0002-three-package-workspace.md) |
| Broker execution / trading         | Different product, different regulatory posture                                 |
| Real-time or intraday prices       | End-of-day is the reporting baseline; intraday adds cost for no decision value  |
| Offline / local-first sync         | Online-first is fine for a web app used at a desk                               |

## What "good" looks like

- Re-importing the same XTB file twice changes nothing.
- A multi-currency buy with a fee reconciles by hand against the ledger.
- A TOS/EDO bond's value matches the official redemption schedule to the grosz.
- No figure on screen exists that cannot be explained from stored events.
