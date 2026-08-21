# Domain

Ledger-first. The transaction log is the system of record; positions,
valuations, P&L, allocation, and income are all derived on read and never
stored. See ADR 0003.

## Tables

| Table                               | Purpose                                        | Notes                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                             | App user                                       | `id` is **our own UUID**. `auth_provider` + `auth_subject` hold the Clerk identity. Nothing else references a provider id. (ADR 0009) |
| `accounts`                          | A brokerage or wrapper account                 | `wrapper`, `broker`, `currency` (base/reporting currency, ADR 0021), `opened_at`, `closed_at`                                         |
| `portfolios` / `portfolio_accounts` | Reporting groups                               | An account can belong to several portfolios                                                                                           |
| `instruments`                       | **Global**, shared across users                | `kind`, `isin`, `symbol`, `exchange`, `currency`, `name`                                                                              |
| `instrument_identifiers`            | Provider ticker mapping                        | `(instrument_id, provider, provider_symbol)` — decouples us from `PKN.WA` vs `PKN` vs `BTC-USD`                                       |
| `transactions`                      | **The ledger**                                 | See below                                                                                                                             |
| `wrapper_rules`                     | Per-wrapper, per-year limits and tax treatment | `(wrapper, year)` → contribution cap, tax rule. Adding OKI in 2027 is rows, not code.                                                 |
| `bond_series_terms`                 | **Global**, lazily populated bond parameters   | See "Bond terms resolve themselves"                                                                                                   |
| `prices`                            | **Global** OHLC cache                          | PK `(instrument_id, granularity, ts)`; granularity is `m15`, `h1`, or `d1`                                                            |
| `fx_rates`                          | **Global** FX cache                            | `(base, quote, date, rate, source)`                                                                                                   |
| `index_observations`                | **Global** macro series                        | `(index_id, effective_from, value)` — NBP reference rate, PL CPI year-on-year                                                         |
| `import_batches` / `import_rows`    | Broker import staging                          | See "Imports"                                                                                                                         |

`instruments`, `prices`, `fx_rates`, `index_observations`, and
`bond_series_terms` are **global and unscoped** — they describe the world, not a
user. Everything else carries `user_id`.

There is deliberately **no general-purpose audit table**. The one audit question
this app actually has — where did this transaction come from? — is answered by
`source`, `import_batch_id`, and the timestamps on the row itself. A generic
`audit_events` table is speculative infrastructure until there is a support
workflow that needs it.

## The transaction row

```
id, user_id, account_id, instrument_id (nullable for pure cash),
type, trade_date, settle_date,
quantity NUMERIC, price NUMERIC, gross_amount NUMERIC, fee NUMERIC, tax NUMERIC,
currency,                    -- transaction currency
fx_rate NUMERIC,             -- the executed rate, only where the broker actually converted (ADR 0021)
fx_rate_source,              -- 'broker' | 'nbp' | 'user'
source,                      -- 'manual' | 'import'
external_id,                 -- broker's own id; unique per (account, external_id)
import_batch_id,
edited_after_import BOOLEAN,
matched_lot_ids JSONB,       -- specific-lot selection on sells; null = strategy default
deleted_at,                  -- soft delete
created_at, updated_at,
note
```

Types: `buy`, `sell`, `dividend`, `interest`, `coupon`, `fee`, `tax`, `deposit`,
`withdrawal`, `transfer_in`, `transfer_out`, `split`, `bond_purchase`,
`bond_redemption`, `bond_early_redemption`.

### The ledger is mutable

Transactions are editable and soft-deletable by their owner. A correction is an
`UPDATE`, not a reversal entry. Full append-only rigour protects stored derived
state and answers "who changed this" in a multi-party system; neither applies
here. See ADR 0004 for the reasoning.

Two guardrails carry the weight instead:

- **`external_id` unique per account** — re-importing the same statement never
  duplicates or resurrects rows.
- **`edited_after_import`** — once you correct an imported row by hand, a later
  re-import shows it as a conflict for review rather than silently overwriting
  your fix.

## Money

- Postgres: `NUMERIC(28, 10)`. Never `float8`, never `money`.
- TypeScript: `decimal.js` wrapped in a `Money` value object
  `{ amount: Decimal; currency: Currency }`. Arithmetic only through `Money`
  methods; mixing currencies throws.
- **`Decimal` runs at 40 significant digits**, set once in `money.ts`. The
  library defaults to 20, which is fewer than the 28 the column holds — a
  division would then round in memory to a precision the database would have
  kept, and pro-rated cost basis stopped summing back to the original.
  Arithmetic must never be less precise than storage.
- Formatting happens at the UI edge via `Intl.NumberFormat`, never in `core`.

See ADR 0005.

## Four currencies, three conversions

This is where portfolio trackers go quietly wrong, so it is specified
explicitly. See ADR 0006 and ADR 0021.

| Currency                  | Meaning                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| **Instrument currency**   | What the instrument trades in — USD for VOO                                    |
| **Transaction currency**  | What the cash leg actually settled in; may be PLN if the broker auto-converted |
| **Account currency**      | The account's base/reporting currency — not a constraint on what it may hold   |
| **Presentation currency** | What the user wants to read — a per-user default, overridable per view         |

Two rules, which must not be confused:

1. **Cost basis is held in the currency a position actually settled in, and is
   never converted to the account currency.** A PLN account can hold a
   EUR-basis position — a BOŚ IKZE genuinely does — with no rate involved at
   all. Where the broker _did_ convert at the transaction itself, the executed
   rate is captured on that transaction and never reconstructed later, because
   brokers convert at their own spread, not NBP's; `fx_rate` is informational
   in that case, kept for tax reporting, and the position engine does not read
   it. A single lot queue that genuinely mixes currencies is refused
   (`MixedCurrencyPositionError`) rather than converted — see ADR 0021.
2. **Presentation uses the valuation-date rate** from `fx_rates` — NBP table A
   mid. Changing presentation currency restates the _view_, never the _book_.

A third rule arrives with tax reporting: Polish realized gains use the NBP rate
from the business day preceding the transaction. Out of scope for v1, but the
schema already carries what it would need.

## Computation

All of it lives in `packages/core` as pure functions. Nothing in this pipeline
performs I/O; data arrives through ports.

```
transactions
   │  buildPositions()       fold ledger → lots per (account, instrument)
   ▼
positions (lot-level)
   │  matchLots(strategy)    FIFO | LIFO | average | specific
   ▼
realized + open lots
   │  valuePositions()       × price(asOf) × fx(asOf); retail bonds accrue instead
   ▼
valuation
   │  ├── allocate()         weights by class / currency / account / wrapper / geography
   │  ├── performance()      TWR (vs benchmark) + XIRR (money-weighted)
   │  └── income()           dividends + interest bucketed over time
   ▼
read models → UI
```

### Lot matching

`LotSelectionStrategy` is an interface with `fifo`, `lifo`, `average`, and
`specific` implementations. **FIFO is the default**, because Polish tax treatment
is effectively FIFO per instrument. A per-instrument default is a user setting; a
per-sale override writes `matched_lot_ids` on the sell transaction, so letting
the user choose exactly which lots a sale consumes never makes the engine
stateful.

### Bond accrual

Retail treasury bonds only — the `bond` `InstrumentKind`. The most bespoke code
in the project, because no data provider prices these; they are subscribed
and redeemed through the Ministry, never traded on any market.

A Catalyst-listed corporate/municipal bond is a different `InstrumentKind`,
`catalyst_bond` — continuously traded on GPW's Catalyst market, priced by
`gpw` exactly like an equity, and valued by one multiplication
(`valueCatalystBondQuote`, ADR 0023) rather than by this engine. The two are
deliberately not the same kind: one is subscribed and redeemed, the other is
bought and sold.

```
accrueBond(terms, purchase, asOf, indexObservations)
  → { nominal, accruedInterest, currentValue, earlyRedemptionValue }
```

| Series | Tenor | Rate mechanism                    |
| ------ | ----- | --------------------------------- |
| OTS    | 3 mo  | Fixed                             |
| ROR    | 1 y   | NBP reference rate, monthly reset |
| DOR    | 2 y   | NBP reference rate + margin       |
| TOS    | 3 y   | Fixed, annually capitalized       |
| COI    | 4 y   | CPI y/y + margin, annual payout   |
| ROS    | 6 y   | CPI y/y + margin, capitalized     |
| EDO    | 10 y  | CPI y/y + margin, capitalized     |
| ROD    | 12 y  | CPI y/y + margin, capitalized     |

The engine is parameterised entirely by the `BondTerms` value object — first
period rate, margin, index reference, capitalization flag, early-redemption fee,
payout schedule. Adding a family is a config entry; adding a series is
automatic.

Validation is non-negotiable: golden tests against the official daily interest
tables published on obligacjeskarbowe.pl. The engine must reproduce them to the
grosz before any bond value is shown to a user.

#### Three conventions the prose does not tell you

All three were established against the Ministry's published ROR0827 table and
all three are load-bearing. See ADR 0016.

1. **The day count is not ACT/365.** Interest for one bond is
   `base × annualRate × periodMonths / 12 × elapsedDays / daysInPeriod` — a
   twelfth (or a quarter, or a whole) of the annual rate, spread linearly across
   that period's own day count. ACT/365 disagrees with the published table on 7
   of 30 days, ACT/366 on 8. Each family's day count is a finding from its own
   table, never inherited from another's.
2. **Rounding is per bond, then multiplied.** The tables are published "dla 1
   sztuki obligacji" and interest is paid per bond; rounding a 25-bond holding
   as a whole pays a different number.
   **A capitalizing family carries its interest forward unrounded.** There is no
   cash amount to round to a grosz until redemption, so the Ministry keeps the
   running balance exact and rounds only what it reports. Capitalizing the
   rounded figure compounds the error: it agrees for two years and then
   disagrees with the published TOS0727 table on 166 of year three's 365 days.
   A paying family is the opposite — each period's interest really does leave
   the account in whole grosze, so that one _is_ rounded.
3. **Periods are anchored to the purchase, not the issue.** Period _n_ runs
   `settledOn.add({months: n × periodMonths})` — measured from the settlement
   date every time, never stepped period by period, which drifts on short
   months. This is why the Ministry publishes one table per purchase date
   ("NABYTYCH W DNIU …"). On a period's exact end date the interest is accrued;
   it becomes paid or capitalized only once the date is strictly past it.

Tax is deliberately **not** applied by the engine. `withholdingOn` is a separate
function, because the 19% Belka rate is a property of the account's wrapper —
IKE and IKZE are exempt — and folding it into the accrual would make the engine
silently wrong for the wrapper that matters most to this product.

### Bond terms resolve themselves

Bond parameters are neither committed data nor something the user types in. They
populate automatically the first time anyone holds a series, and every
subsequent user gets them from the shared table. See ADR 0011.

A series code such as `EDO0835` decomposes into two layers:

- **Family rules** (`EDO` → 10-year tenor, CPI-indexed, annual capitalization,
  early-redemption fee, payout schedule). Eight families, changing on the order
  of once a decade. Versioned, effective-dated configuration in
  `packages/core/src/bonds/families.ts`.
- **Per-issue parameters** (issue month `08/35` → first-period rate, margin over
  the index). Two numbers, published monthly.

`BondTermsResolver` composes them: derive the family rules, fetch the per-issue
parameters, write the resolved `BondTerms` into the global `bond_series_terms`
table, return it. Cache-on-first-use, exactly like prices.

### Performance

Both metrics, because they answer different questions:

- **TWR (time-weighted)** neutralizes deposits and withdrawals. The only fair way
  to compare against an index, so this drives the benchmark chart.
- **XIRR / MWR (money-weighted)** is what the investor actually earned given
  their timing. This is the headline number.

Benchmarks are just instruments with a price series — WIG/WIG20, an accumulating
world ETF, S&P 500. The same TWR function runs over the benchmark series, so
adding one is configuration.

### Allocation

`allocate(valuation, dimension)` where dimension is `instrument`, `assetClass`,
`currency`, `account`, `wrapper`, `geography`, or `sector`. Computed across **all
accounts combined** by default, so the headline is the total split of net worth
by whichever dimension is selected, with drill-down.

### Income

Dividends, coupons, and bond interest folded into monthly, quarterly, and yearly
buckets — per instrument and in aggregate, with yield-on-cost and a
year-over-year overlay, so the trend in payouts is visible and not just the
totals. Because it derives from the same ledger, a new income type is one enum
member and one fold case.

### Tax wrappers are data

IKE, IKZE, PPK, and OKI differ in contribution limits and tax treatment. Those
live in `wrapper_rules` keyed by `(wrapper, year)` — limits change annually, and
OKI arrives in 2027. Adding it is a migration plus rows; no computation code is
touched.

## Imports

**Raw uploaded files go to Vercel Blob (private), not the database.** Blob is
built for it, it keeps the primary database small, and it works identically
whichever engine ADR 0008 resolves to. The `FileStore` port keeps Blob itself
swappable.

See ADR 0015 for the `StatementParser` port itself. The database keeps only
what the review UI needs:

- `import_batches` — user, account, broker, blob key, uploaded_at, status
  (`pending` / `parsed` / `failed`), a failure reason when `failed`, and
  `total`/`accepted`/`rejected`/`duplicate` row counts. The account is chosen
  by the user at upload time, never detected from the file. Status tracks only
  whether the parse itself succeeded — "does this batch still have unreviewed
  rows" is a query over `import_rows`, not a second copy of that fact here.
  The counts are a snapshot taken once row processing is final, not a
  live-synced counter: while a batch is under review, the true numbers are a
  query over `import_rows`; the stored snapshot exists because `import_rows`
  is pruned and the counts are what survives that prune.
- `import_rows` — batch id, row index, the **normalized parsed row** as JSON,
  status (`pending` / `accepted` / `rejected` / `duplicate`), the resulting
  `transaction_id`, and a reason if rejected.

A parsed row is a few hundred bytes, so a 500-row statement is well under a
megabyte. Retention: prune accepted batches' rows after 90 days — the resulting
transactions are the durable artifact.

On engine portability: Postgres stores these as `JSONB`, SQLite as TEXT read
through `json_*`. Both work, and the domain type is identical either way, because
the repository returns a parsed object and the column type is `packages/db`'s
private business.
