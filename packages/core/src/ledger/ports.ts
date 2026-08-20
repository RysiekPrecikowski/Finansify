import { type UserId } from '../ports/session';
import {
  type Account,
  type AccountId,
  type AccountInput,
  type Instrument,
  type InstrumentId,
  type InstrumentKind,
  type Portfolio,
  type Transaction,
  type TransactionId,
  type TransactionInput,
} from './types';
import { type Currency } from '../money';

/**
 * Everything the import use case knows about a transaction it is about to
 * create that `TransactionInput` deliberately does not carry — `source`,
 * `externalId` and `importBatchId` are never user-submittable fields (there is
 * no form field for any of them), so they travel as a separate, narrower
 * argument rather than being added to the shared schema every manual-entry
 * caller also validates against. `importBatchId` is a plain `string`, not the
 * branded `ImportBatchId`: `ledger` and `imports` are siblings that never
 * import from each other (`docs/architecture.md`), and `Transaction.importBatchId`
 * itself is already typed as a plain string for the same reason.
 */
export interface ImportedTransactionOrigin {
  readonly externalId: string;
  readonly importBatchId: string;
}

/**
 * Everything a signed-in user can do to their own ledger.
 *
 * **No method takes a `userId`.** It is captured once, when the repository is
 * constructed, so an unscoped query is not something a developer has to
 * remember to avoid — it is something they cannot express. ADR 0009 declines
 * row-level security precisely on the strength of this shape, which means there
 * is no database-level backstop if an implementation ignores it.
 */
export interface ScopedLedgerRepository {
  listAccounts(): Promise<readonly Account[]>;
  createAccount(input: AccountInput): Promise<Account>;

  listPortfolios(): Promise<readonly Portfolio[]>;
  /**
   * Returns this user's default portfolio, creating it on first access — the
   * same lazy provisioning ADR 0009 chose for the `users` row itself, for the
   * same reason: one creation path rather than two.
   */
  ensureDefaultPortfolio(name: string): Promise<Portfolio>;

  /** Every transaction that is not soft-deleted, oldest first. */
  listTransactions(): Promise<readonly Transaction[]>;
  getTransaction(id: TransactionId): Promise<Transaction | null>;
  createTransaction(input: TransactionInput): Promise<Transaction>;
  updateTransaction(id: TransactionId, input: TransactionInput): Promise<Transaction>;
  /** Sets `deleted_at`. A hard delete would break import idempotency (ADR 0004). */
  softDeleteTransaction(id: TransactionId): Promise<void>;

  /**
   * The dedup lookup a re-import runs before creating anything — the partial
   * unique index on `(account_id, external_id)` is what this query mirrors.
   * `null` for a manually entered transaction, which never carries an
   * `external_id` at all.
   */
  findByExternalId(accountId: AccountId, externalId: string): Promise<Transaction | null>;
  /**
   * The bulk counterpart to `findByExternalId` — one query for every
   * `externalId` in a batch rather than one round trip per row. Keyed by
   * `externalId`; an id with no existing transaction is simply absent from
   * the map, same "at most one row" guarantee `findByExternalId`'s own doc
   * comment describes.
   */
  findByExternalIds(
    accountId: AccountId,
    externalIds: readonly string[],
  ): Promise<ReadonlyMap<string, Transaction>>;
  /**
   * The only way a transaction is ever created with `source: 'import'` — see
   * `ImportedTransactionOrigin`. Not reachable from `createTransaction`, so a
   * manual form submission can never forge an import provenance.
   */
  createImportedTransaction(
    input: TransactionInput,
    origin: ImportedTransactionOrigin,
  ): Promise<Transaction>;
  /**
   * The bulk counterpart to `createImportedTransaction` — one multi-row
   * insert for a whole batch of creates rather than one round trip per row.
   * Returns every created transaction, in no particular order; match a
   * result back to the item that produced it by `externalId`, which is
   * unique within `accountId` (the same uniqueness `findByExternalIds`
   * relies on).
   */
  createImportedTransactions(
    items: readonly {
      readonly input: TransactionInput;
      readonly origin: ImportedTransactionOrigin;
    }[],
  ): Promise<readonly Transaction[]>;
  /**
   * Refreshes an import-sourced transaction's fields from a re-import,
   * without touching `editedAfterImport` — unlike `updateTransaction`, which
   * always sets that flag when the transaction's `source` is `'import'`, on
   * the assumption that whoever calls it is a human correcting a row by
   * hand. The import use case is the other caller: it refreshes a row
   * nobody has touched, and that row has to stay refreshable by the *next*
   * re-import too, or a single restatement would look like a hand edit
   * forever and every later re-import would misreport it as a conflict.
   */
  refreshImportedTransaction(id: TransactionId, input: TransactionInput): Promise<Transaction>;
  /**
   * The bulk counterpart to `refreshImportedTransaction` — one round trip
   * refreshing every item in `items` rather than one per row, the same
   * "fixed number of round trips" shape `createImportedTransactions` already
   * has. Only for rows `classifyReimport` already found `changed` — the
   * caller is expected to have filtered out `unchanged` matches itself, since
   * writing back data that already matches is exactly the wasted work this
   * exists to avoid.
   */
  refreshImportedTransactions(
    items: readonly { readonly id: TransactionId; readonly input: TransactionInput }[],
  ): Promise<readonly Transaction[]>;
}

export interface LedgerRepository {
  forUser(userId: UserId): ScopedLedgerRepository;
}

export interface InstrumentInput {
  readonly symbol: string;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly currency: Currency;
  readonly isin?: string | null;
  readonly exchange?: string | null;
}

/**
 * Instruments are global and shared between users (`docs/domain.md`), so this
 * port is deliberately **not** part of the user-scoped repository above. There
 * is nothing private here to leak.
 */
export interface InstrumentRepository {
  findOrCreate(input: InstrumentInput): Promise<Instrument>;
  findById(id: InstrumentId): Promise<Instrument | null>;
  listAll(): Promise<readonly Instrument[]>;
  /** Local-first match on symbol, name, or ISIN, case-insensitive. `searchInstruments` only calls this with a non-empty, trimmed query. */
  search(query: string): Promise<readonly Instrument[]>;
}
