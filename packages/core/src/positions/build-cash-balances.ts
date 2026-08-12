import { grossValueOf, type AccountId, type Transaction, type TransactionType } from '../ledger';
import { Money, type Currency } from '../money';

export interface CashBalance {
  readonly accountId: AccountId;
  readonly currency: Currency;
  readonly amount: Money;
}

/** Types whose principal is money arriving. Everything else that moves cash pays out. */
const inflowTypes = new Set<TransactionType>([
  'deposit',
  'sell',
  'dividend',
  'interest',
  'coupon',
  'bond_redemption',
  'bond_early_redemption',
]);

const outflowTypes = new Set<TransactionType>(['withdrawal', 'buy', 'fee', 'tax', 'bond_purchase']);

/**
 * What each transaction does to the account's cash.
 *
 * Fees and tax always leave, whichever way the principal went — that is what
 * makes a buy cost `gross + fee` and a sale return `gross - fee - tax`, and it
 * is the same arithmetic `costBasisOf` and `netProceedsOf` use, so cash and
 * cost basis cannot disagree.
 */
function cashDeltaOf(transaction: Transaction): Money | null {
  const costs = transaction.fee.plus(transaction.tax);

  // A securities transfer moves units, not money; a cash transfer has no
  // instrument attached.
  const isCashTransfer =
    (transaction.type === 'transfer_in' || transaction.type === 'transfer_out') &&
    transaction.instrumentId === null;

  if (inflowTypes.has(transaction.type) || (isCashTransfer && transaction.type === 'transfer_in')) {
    return grossValueOf(transaction).minus(costs);
  }
  if (
    outflowTypes.has(transaction.type) ||
    (isCashTransfer && transaction.type === 'transfer_out')
  ) {
    return grossValueOf(transaction).negated().minus(costs);
  }

  // `split` changes unit counts and nothing else; a securities transfer is
  // handled by the position engine.
  return null;
}

/**
 * Cash per `(account, currency)` — **never summed across currencies**.
 *
 * The cash leg settles in the *transaction* currency (`docs/domain.md`), so an
 * account that bought in USD genuinely holds a USD sub-balance. Collapsing
 * those into one figure needs a valuation-date rate, which is Phase 2; doing it
 * here would mean inventing one, which is precisely what rule 6 forbids.
 *
 * Needs no price and no FX feed, which is why it belongs in Phase 1: without
 * it, entering a purchase never takes the money out of the account.
 */
export function buildCashBalances(transactions: readonly Transaction[]): readonly CashBalance[] {
  const totals = new Map<string, CashBalance>();

  for (const transaction of transactions) {
    const delta = cashDeltaOf(transaction);
    if (delta === null) continue;

    const key = `${transaction.accountId}::${transaction.currency}`;
    const running = totals.get(key);

    totals.set(key, {
      accountId: transaction.accountId,
      currency: transaction.currency,
      amount: running === undefined ? delta : running.amount.plus(delta),
    });
  }

  return [...totals.values()];
}
