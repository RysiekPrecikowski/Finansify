# 0021. Cost basis lives in the position's settlement currency

**Status:** Accepted
**Date:** 2026-08-20

## Context

`packages/core` currently assumes that a transaction whose currency differs
from its account's currency was **converted by the broker at that
transaction**: `buildPositions` calls `toAccountCurrency`
(`packages/core/src/positions/build-positions.ts`), which requires
`Transaction.fxRate` whenever `transaction.currency !== account.currency` and
throws `MissingExecutedRateError` otherwise.

That assumption is true for XTB, where an account is one currency by
construction — `mapCashOperationRow`
(`packages/importers/src/xtb/map-operation.ts`) sets
`currency = ctx.accountCurrency` on every row it emits, so the mismatched-
currency path has never actually been exercised by an import, only by manual
entry.

It is false for BOŚ (Dom Maklerski BOŚ). A real IKZE account export was
examined: 36 rows holding PLN, EUR and USD in **one** account — 6 EUR
purchases of a single ETF, 11 USD dividend payments, 14 currency-exchange legs
(`Wymiana waluty`, paired PLN/EUR and USD/EUR), and 5 PLN deposits. A EUR
purchase is settled out of the account's EUR balance; the PLN→EUR conversion
that funded it happened earlier, as its own explicit operation with its own
recorded rate. Nothing here was converted at the trade.

Three facts make fixing this a small change rather than a large one:

- `Transaction.fxRate` has exactly **one** consumer that computes with it:
  `toAccountCurrency`. Every other occurrence stores it, serialises it,
  exports it, or compares it on re-import.
- The layer above `buildPositions` is already multi-currency and already
  refuses to blend: `costBasisByCurrency` / `realizedByCurrency`
  (`packages/core/src/usecases/list-positions.ts`), `unrealizedByCurrency` /
  `marketValueByCurrency` (`packages/core/src/valuation/value-positions.ts`),
  and `averageCost` already returns `null` when more than one currency
  contributes to a position.
- BOŚ does support converting on the transaction itself, according to its
  documentation, but no real export in hand shows a row shaped that way.

## Decision

- A position's cost basis is held in the currency the position was actually
  settled in, not its account's currency. `Account.currency` is the account's
  **base/reporting** currency, not a constraint on what it may hold —
  `buildCashBalances` already tracks cash per `(account, currency)`, so this
  reading was already true for cash; it now also holds for positions.
- The lot queue stays **one per `(account, instrument)`**. It is not split by
  currency: FIFO matches units, and splitting the queue by currency would
  break lot matching on sale. The queue's currency is fixed by its first
  chronological transaction.
- `buildPositions` performs **no currency conversion at all**. A transaction
  arriving on a queue held in a different currency raises
  `MixedCurrencyPositionError`, naming both currencies. This case is
  deliberately unsupported rather than converted: no export in hand exhibits
  it, and picking a rate direction with nothing to check it against is exactly
  the reconstruction rule 6 (ADR 0006) forbids.
- `Transaction.fxRate` / `fxRateSource` keep their meaning and their storage.
  They are informational, kept for tax reporting, and the position engine does
  not read them. Rule 6 is **not** relaxed: an executed rate is still stored
  wherever the broker actually converted, and is still never reconstructed
  after the fact — it stops being _required_ on rows where no conversion took
  place.

## Consequences

BOŚ IKZE imports need zero invented rates. The 6 EUR purchases form a
EUR-basis position; the 11 USD dividends and the 14 currency-exchange legs
never reach the position engine at all — `dividend` is neither an opening nor
a closing type, and exchange legs carry `instrumentId: null`.

**BOŚ supports converting on the transaction itself.** We have no export
showing it, so nothing is built for it now, and nothing needs to be: such a
row would arrive with `currency` set to the currency that actually left the
account and `fxRate` recording the executed rate. The queue would then already
be in that currency, and the position engine needs no change to handle it.
Keeping that path open is the reason `fxRate` is preserved end to end rather
than removed, and why `transactionInputSchemaFor` keeps its
`accountCurrency` parameter even though the parameter goes unused in the
body — it is the seam a future BOŚ conversion-on-transaction rule would use.

A validation error moves from write time to read time. A position that
genuinely mixes currencies now fails when positions are built, not when the
transaction is entered. Accepted deliberately: a write-time guard would mean
threading `listTransactions()` into
`validateTransactionInputAgainstAccounts`, which is intentionally pure so
`makeAcceptImportRows` can batch it. Revisit if this actually bites in
practice.

Existing hand-entered foreign-currency transactions that carry a rate will
start reporting their basis in the transaction's own currency instead of the
account's. This is a behaviour change on existing data — and it is the more
honest number: it was always the currency the position was actually held in.

## Alternatives considered

**One account per currency, as XTB has.** Rejected: a BOŚ IKZE is one wrapper
with one statutory contribution limit, and `contributionRoomFor`
(`packages/core/src/wrappers/wrapper-rules.ts`) counts deposits per account.
Splitting would break the limit and turn currency exchanges into
cross-account transfers the model has no way to pair.

**Filling the missing rate from NBP at accept time**, marked
`fxRateSource: 'nbp'`. Rejected: it treats the symptom and leaves the false
premise — "a currency difference implies a conversion" — in place.

**FIFO over currency lots** — matching the EUR spent on a purchase back to the
specific exchange that bought it. Economically the most correct answer, and
worth revisiting one day, but it is a cash-lot engine, not a parser detail,
and it has no answer for USD dividends, which arrive with no acquisition rate
at all.
