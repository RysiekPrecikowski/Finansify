# 0015. The import boundary: what a `StatementParser` owns, and what it deliberately does not

**Status:** Accepted
**Date:** 2026-08-15

## Context

Phase 4 needs to turn a broker's exported statement into ledger rows. Before
any adapter code was written, real XTB exports were examined — all three of
the user's accounts (EUR, PLN, USD), two separate export bundles months apart
— to answer what a parser can actually promise, rather than guessing and
discovering the gaps in production.

**The export is xlsx only, three sheets.** `Cash Operations`, `Open
Positions`, `Closed Positions`. No CSV, no PDF, no API. `Open`/`Closed
Positions` are not a cross-check to skip — they are how a stock split, a
spin-off with no cash trace, and a position with no counterpart anywhere else
in the export get caught at all. On the real PLN account, all three appeared.

**There is no explicit FX rate column.** `|Amount| / (quantity × price)`,
taken as a median over tickets with gross ≥ 20 units, cleanly separates 1.0
(same-currency) from converted tickers across 34 `(account, ticker)` pairs
tested, including a cross-account consistency check: the same USD-denominated
instrument reads ≈1.0 from the USD account and ≈0.90–0.98 from the EUR
account, which is the FX spread, not noise.

**File-hash dedup on the upload does not work.** The same account's export,
re-downloaded weeks apart with identical underlying transactions, hashes
differently — XTB embeds a generation timestamp in the file itself. The only
dedup signal that survives a re-export is the broker's own row id
(`external_id`), which rule 4/ADR 0004 already made the mechanism for exactly
this reason.

**Investment Plans and the eWallet card were both investigated and dropped.**
A plan looked like a natural sub-account, but there is no reliable signal in
the export for which rows belong to a plan versus the main account, so
building a `parent_account_id`/`role` model on top of unverifiable data was
declined — a good abstraction over a wrong guess is still a wrong guess. The
eWallet (`DIR:I2B`/`DIR:B2I`) was investigated as a possible in/out leg pair,
matchable by `CID` — disproven: all 59 `CID`s observed are unique, so there is
no pairing signal to reconstruct. Both are out of scope, not deferred; see
"Alternatives considered."

## Decision

**`StatementParser` (`packages/core/src/ports/statement-parser.ts`) is
narrow: `sniff()` and `parse()`, nothing else.** It takes a `RawFile` and
returns `ParsedRow[]` — it never touches `InstrumentRepository`,
`LedgerRepository`, or `FileStore`. Resolving an instrument, matching an
account, and deduping against existing transactions are all downstream of
`parse()`, in later tickets — "adapters never import each other"
(`docs/architecture.md`) applies to `packages/importers` exactly as it does to
`db` and `providers`.

**`RawFile` carries `Uint8Array`, not `Blob`.** `packages/core` builds against
`lib: ["ES2023"]` with no DOM lib and no `@types/node` — `Blob` is a host
object neither provides. `Uint8Array` is plain ECMAScript, so the "depends on
nothing" rule holds at the type level, not only at the import level.
`apps/web`'s upload route converts a `Blob`/`File` to `Uint8Array` at the edge,
before anything in `core` or `packages/importers` sees it.

**`sniff()` returns a three-state `Confidence` (`'certain' | 'possible' |
'none'`), not a numeric score.** A calibrated 0–1 confidence invites a
threshold nobody can justify from one broker's worth of evidence. Three states
are exactly what the upload flow acts on: parse outright, offer as a guess
among several parsers, or don't offer this one.

**A `ParsedRow` carries an unresolved `ParsedInstrumentCandidate`
(`symbol`/`exchange`/`name`), never an `InstrumentId`.** The parser has no
`InstrumentRepository` to resolve against — that is the instrument-resolution
UI's job, a separate ticket with its own auto-match/confirm flow, reusing
`findOrCreate`/`search` rather than the parser reimplementing matching logic
it has no database access to do correctly anyway.

**`ParsedRow.warnings` is a plain `string[]`, attached at parse time, never
blocking.** A reconciliation mismatch against `Closed Positions`, an inferred
FX rate, an assumption the parser had to make — all become a warning on the
row for the review screen (its own ticket) to surface. `parse()` never throws
on a mismatch and never drops a row because of one; a missing price is an
error (rule 7), a present-but-surprising one is not the same failure mode and
does not get the same treatment.

**No sub-accounts. No eWallet/card modeling, at all.** An `I2B`/`B2I` row is a
plain `withdrawal`/`deposit` on the account it appears on — full stop, not
routed through any wallet abstraction, not paired with its counterpart leg
even where one plausibly exists. This is not "not yet built" — it is declined,
for the reasons in Context, and revisiting it needs new evidence, not a
different implementation of the same guess.

**Dedup is `external_id` only.** No file-hash check on upload, no
content-hash on the batch. A `ParsedRow` without a stable `externalId` is not
a valid row a parser may emit — every implementation must guarantee one, or
Duplicate/re-import protection (ADR 0004) silently stops working for that
broker.

## Consequences

A statement a `StatementParser` cannot fully explain is not a parser bug to
work around — `warnings` exists precisely so "the export doesn't say enough"
becomes a visible, resolvable fact for the user rather than a silently wrong
number or a thrown exception that blocks the whole batch.

Because instrument resolution is fully downstream, `packages/importers` never
needs a database connection, network access, or `InstrumentRepository` at all
— `sniff()`/`parse()` are pure transformations over bytes already in memory,
which is what makes them straightforward to test against a fixture file with
no I/O (rule 17's "tests follow the code" applies once ticket 3 exists; the
port itself has no runtime behavior to test, the same as `Clock`).

Declining sub-accounts and wallet modeling means an Investment Plan's rows and
a card top-up both land as ordinary rows against the main account today. If
that turns out to matter later, it is new scope with its own ADR, not a
retrofit onto this one — the alternative (building the abstraction now, on
data that does not currently support it) was tried in planning and reversed
once it became clear it could not be verified.

Every future broker parser (Boś, named directly in the roadmap) inherits this
shape whether or not its own export has the same gaps XTB's does. A parser
with, say, a real FX rate column simply never populates that particular
warning — the port does not need to know in advance which broker can and
cannot answer which question.

## Alternatives considered

**Numeric `sniff()` confidence (0–1).** Rejected — see Decision. Nothing in
this project calibrates such a score today, and a fake-precise number is worse
than an honest three-state answer.

**File-hash or content-hash dedup on `import_batches`.** Investigated and
rejected — see Context. `external_id` is the only signal proven to survive a
re-export.

**`parent_account_id`/`role` sub-accounts for Investment Plans.** Proposed
during planning, dropped once real exports showed no reliable way to attribute
a row to a specific plan versus the main account. A general mechanism over
unverifiable data is not more correct than no mechanism — it is a wrong guess
with better ergonomics.

**CID-paired eWallet legs**, modeling the card as a pseudo-account with
in/out transfers between it and the brokerage account. Disproven directly:
every `CID` observed across a real export is unique, so there is no pairing
key to build this on. Plain deposit/withdrawal is not a simplification of this
approach — it is what remains once the pairing premise is gone.

**Giving the parser `InstrumentRepository` access**, so it resolves
instruments itself instead of returning candidates. Rejected: it would make
`packages/importers` depend on `db`-backed state to do something a dedicated
UI (its own ticket, with a confirm step) already needs to do anyway, and it
collapses "the file says AAPL" and "AAPL resolved to this exact instrument
row" into one step that a user can no longer intervene on before it happens.
