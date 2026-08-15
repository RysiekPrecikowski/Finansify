import type Decimal from 'decimal.js';

import { type FxRateSource, type TransactionType } from '../ledger';
import { type Currency, type Money } from '../money';
import { type Temporal } from '../time';

/**
 * A broker's own name for itself — `'xtb'`, later `'bos'`. Deliberately a bare
 * string rather than a branded id or a closed union: `accounts.broker` is
 * already free text (an account can name a broker with no parser at all), and
 * the set of parsers is something adapters register, not domain vocabulary
 * `core` closes over (contrast `Wrapper`/`TransactionType` in
 * `ledger/vocabulary.ts`, which genuinely are closed).
 */
export type BrokerId = string;

/**
 * A file as uploaded, before anything is known about its contents.
 * `Uint8Array` rather than `Blob` or a Node `Buffer`: both are host objects
 * `packages/core`'s `lib: ["ES2023"]`, DOM-free build target does not carry
 * (rule 2 — "depends on nothing" extends to ambient globals, not only
 * imports), where `Uint8Array` is plain ECMAScript. `apps/web`'s upload route
 * converts a `Blob`/`File` to this at the boundary, before anything in `core`
 * or `packages/importers` sees it.
 */
export interface RawFile {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

/**
 * `sniff()`'s answer to "can you parse this file" — three states, not a
 * numeric score. A calibrated confidence number invites a threshold nobody can
 * justify; these three are the only distinctions the upload flow (ticket 4)
 * actually acts on: parse it outright, offer it as a guess among several, or
 * don't offer this parser at all.
 */
export type Confidence = 'certain' | 'possible' | 'none';

/**
 * An instrument as a parser sees it: a ticker on a statement line, not yet
 * resolved against `InstrumentRepository`. Resolution is a separate step
 * (instrument-resolution UI, its own ticket) with its own auto-match/confirm
 * flow — a parser never calls `findOrCreate` itself, so `packages/importers`
 * never needs an `InstrumentRepository` dependency at all.
 */
export interface ParsedInstrumentCandidate {
  readonly symbol: string;
  readonly exchange: string | null;
  readonly name: string | null;
}

/**
 * One statement line, normalized to the shape `import_rows.parsed` stores and
 * the import use case (its own ticket) turns into a real `Transaction` once
 * dedup, instrument resolution, and reconciliation have all run. Deliberately
 * the same fields as `Transaction` where they overlap — this is a
 * not-yet-linked transaction, not a different shape — minus `id`/`accountId`
 * (the account is chosen at upload time, never detected from the file) and
 * with `instrument` widened to an unresolved candidate.
 */
export interface ParsedRow {
  /**
   * The broker's own row identifier. Becomes `transactions.external_id`, the
   * sole re-import dedup key (rule 4/ADR 0004) — every parser must emit one,
   * stable across repeated exports of the same statement.
   */
  readonly externalId: string;
  readonly instrument: ParsedInstrumentCandidate | null;
  readonly type: TransactionType;
  readonly tradeDate: Temporal.PlainDate;
  readonly settleDate: Temporal.PlainDate | null;
  readonly quantity: Decimal;
  readonly price: Money | null;
  readonly grossAmount: Money | null;
  readonly fee: Money;
  readonly tax: Money;
  readonly currency: Currency;
  readonly fxRate: Decimal | null;
  readonly fxRateSource: FxRateSource | null;
  readonly note: string | null;
  /**
   * Non-blocking findings attached at parse time — an inferred FX rate, a
   * reconciliation mismatch against the statement's own closed-position
   * total, an assumption the parser had to make. Surfaced on the review
   * screen (its own ticket); never causes `parse()` to throw or drop the row.
   * A missing price is an error (rule 7 of `CLAUDE.md`); a surprising but
   * present one is a warning, not a rejection.
   */
  readonly warnings: readonly string[];
}

export interface ParsedStatement {
  readonly broker: BrokerId;
  readonly rows: readonly ParsedRow[];
}

/**
 * Inbound adapter port: turns a broker's raw export into normalized rows.
 * Implementations live in `packages/importers` and never import
 * `InstrumentRepository`, `LedgerRepository`, or `FileStore` — resolving an
 * instrument, matching an account, and deduping against existing transactions
 * are all downstream of `parse()`, not the parser's job (`docs/architecture.md`:
 * "adapters never import each other").
 */
export interface StatementParser {
  readonly broker: BrokerId;
  /** Cheap and fast — checked against every registered parser before the user picks one. */
  sniff(file: RawFile): Promise<Confidence>;
  /** Only called after the user (or an unambiguous `sniff()`) has picked this parser. */
  parse(file: RawFile): Promise<ParsedStatement>;
}
