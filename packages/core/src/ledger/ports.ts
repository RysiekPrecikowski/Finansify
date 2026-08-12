import { type UserId } from '../ports/session';
import {
  type Account,
  type AccountInput,
  type Instrument,
  type InstrumentKind,
  type Portfolio,
  type Transaction,
  type TransactionId,
  type TransactionInput,
} from './types';
import { type Currency } from '../money';

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
  listAll(): Promise<readonly Instrument[]>;
}
