import {
  DECIMAL_ZERO,
  toDecimal,
  type CurrencyCode,
  type Decimal,
  type DecimalInput,
} from './money';
import { toEpochMilliseconds } from './time';

export const TRANSACTION_TYPES = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * The FX rate used for accounting conversion is stored on the transaction itself,
 * never re-derived later. Re-deriving would make historical balances shift whenever
 * the rate series is corrected. See docs/domain.md.
 */
export interface LedgerTransaction {
  type: TransactionType;
  amount: Decimal;
  currency: CurrencyCode;
  accountCurrency: CurrencyCode;
  fxRateToAccountCurrency: Decimal;
}

export interface TimedLedgerTransaction extends LedgerTransaction {
  occurredAt: string;
}

/** Cash effect direction: money into the account is positive. */
export function getTransactionSign(type: TransactionType): Decimal {
  return type === 'SELL' || type === 'DEPOSIT' ? toDecimal('1') : toDecimal('-1');
}

export function calculateTransactionAmountInAccountCurrency(
  transaction: LedgerTransaction,
): Decimal {
  if (transaction.fxRateToAccountCurrency.lte(0)) {
    throw new Error('fxRateToAccountCurrency must be greater than zero');
  }

  return getTransactionSign(transaction.type)
    .mul(transaction.amount)
    .mul(transaction.fxRateToAccountCurrency);
}

export function sumTransactionAmountsInAccountCurrency(
  transactions: readonly LedgerTransaction[],
): Decimal {
  return transactions.reduce(
    (sum, transaction) => sum.plus(calculateTransactionAmountInAccountCurrency(transaction)),
    DECIMAL_ZERO,
  );
}

export function calculateCashBalance(
  transactions: readonly LedgerTransaction[],
  openingBalance: DecimalInput = DECIMAL_ZERO,
): Decimal {
  return toDecimal(openingBalance).plus(sumTransactionAmountsInAccountCurrency(transactions));
}

export function filterTransactionsAtOrBefore(
  transactions: readonly TimedLedgerTransaction[],
  asOf: string,
): TimedLedgerTransaction[] {
  const asOfEpoch = toEpochMilliseconds(asOf);

  return transactions.filter(
    (transaction) => toEpochMilliseconds(transaction.occurredAt) <= asOfEpoch,
  );
}

export function calculateCashBalanceAt(
  transactions: readonly TimedLedgerTransaction[],
  asOf: string,
  openingBalance: DecimalInput = DECIMAL_ZERO,
): Decimal {
  return toDecimal(openingBalance).plus(
    sumTransactionAmountsInAccountCurrency(filterTransactionsAtOrBefore(transactions, asOf)),
  );
}
