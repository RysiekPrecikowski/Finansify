import type Decimal from 'decimal.js';

import { type ScopedLedgerRepository, type InstrumentRepository } from '../ledger/ports';
import {
  type Account,
  type AccountId,
  type Instrument,
  type InstrumentId,
  type Transaction,
  type TransactionId,
  type TransactionType,
  type FxRateSource,
  type TransactionSource,
} from '../ledger/types';
import { type Currency, type Money } from '../money';
import { UnknownAccountError } from '../positions';
import { type Temporal } from '../time';

import { UnknownInstrumentError } from './list-positions';

/**
 * One row of the flat, joined ledger — the read model behind "download my
 * whole ledger as CSV/JSON" (`docs/roadmap.md`, Phase 1's "Export"). No
 * computation happens here, unlike `list-positions.ts`: it is a straight join
 * of a transaction to its account and instrument, so a re-import elsewhere has
 * everything it needs without a second lookup.
 */
export interface LedgerExportRow {
  readonly transactionId: TransactionId;
  readonly account: Account;
  /** `null` for a pure cash movement — a deposit references no instrument. */
  readonly instrument: Instrument | null;
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
  readonly source: TransactionSource;
  readonly externalId: string | null;
  readonly matchedLotIds: readonly TransactionId[] | null;
  readonly note: string | null;
}

export function makeExportLedger(deps: {
  ledger: ScopedLedgerRepository;
  instruments: InstrumentRepository;
}) {
  return async function exportLedger(): Promise<readonly LedgerExportRow[]> {
    const [transactions, accounts, instruments] = await Promise.all([
      deps.ledger.listTransactions(),
      deps.ledger.listAccounts(),
      deps.instruments.listAll(),
    ]);

    const accountsById = new Map<AccountId, Account>(
      accounts.map((account) => [account.id, account]),
    );
    const instrumentsById = new Map<InstrumentId, Instrument>(
      instruments.map((instrument) => [instrument.id, instrument]),
    );

    return transactions.map((transaction: Transaction): LedgerExportRow => {
      const account = accountsById.get(transaction.accountId);
      if (account === undefined) throw new UnknownAccountError(transaction.accountId);

      const instrument =
        transaction.instrumentId === null ? null : instrumentsById.get(transaction.instrumentId);
      if (instrument === undefined && transaction.instrumentId !== null) {
        throw new UnknownInstrumentError(transaction.instrumentId);
      }

      return {
        transactionId: transaction.id,
        account,
        instrument: instrument ?? null,
        type: transaction.type,
        tradeDate: transaction.tradeDate,
        settleDate: transaction.settleDate,
        quantity: transaction.quantity,
        price: transaction.price,
        grossAmount: transaction.grossAmount,
        fee: transaction.fee,
        tax: transaction.tax,
        currency: transaction.currency,
        fxRate: transaction.fxRate,
        fxRateSource: transaction.fxRateSource,
        source: transaction.source,
        externalId: transaction.externalId,
        matchedLotIds: transaction.matchedLotIds,
        note: transaction.note,
      };
    });
  };
}
