import Decimal from 'decimal.js';

import { type ScopedLedgerRepository, type InstrumentRepository } from '../ledger/ports';
import { type Account, type AccountId, type Instrument, type InstrumentId } from '../ledger/types';
import { type Money } from '../money';
import {
  averageCostOf,
  buildCashBalances,
  buildPositions,
  defaultLotStrategy,
  UnknownAccountError,
  type CashBalance,
  type LotStrategy,
  type Position,
} from '../positions';

export class UnknownInstrumentError extends Error {
  constructor(id: InstrumentId) {
    super(
      `No instrument ${id} was found; every transaction's instrument should already have been resolved via findOrCreate`,
    );
    this.name = 'UnknownInstrumentError';
  }
}

export interface AccountPositionLine {
  readonly account: Account;
  readonly quantity: Decimal;
  readonly costBasis: Money;
  readonly averageCost: Decimal | null;
  readonly realized: Money;
  readonly lots: Position['lots'];
}

export interface InstrumentPosition {
  readonly instrument: Instrument;
  readonly quantity: Decimal;
  /** Grouped by currency — never summed across currencies, or a rate would be invented (rule 6). */
  readonly costBasisByCurrency: readonly Money[];
  /** `null` unless exactly one currency contributes and quantity is nonzero — a blended figure across currencies or a division by zero would both be invented numbers. */
  readonly averageCost: Decimal | null;
  readonly realizedByCurrency: readonly Money[];
  readonly lines: readonly AccountPositionLine[];
}

export interface CashBalanceLine {
  readonly account: Account;
  readonly amount: Money;
}

export interface PositionsView {
  readonly open: readonly InstrumentPosition[];
  readonly closed: readonly InstrumentPosition[];
  readonly cash: readonly CashBalanceLine[];
}

/** Exported for `valuation/value-positions.ts`, which groups market value and unrealized P&L the same way. */
export function groupByCurrency(amounts: readonly Money[]): readonly Money[] {
  const totals = new Map<string, Money>();
  for (const amount of amounts) {
    const running = totals.get(amount.currency);
    totals.set(amount.currency, running === undefined ? amount : running.plus(amount));
  }
  return [...totals.values()];
}

export function makeListPositions(deps: {
  ledger: ScopedLedgerRepository;
  instruments: InstrumentRepository;
}) {
  return async function listPositions(options?: {
    strategy?: LotStrategy;
  }): Promise<PositionsView> {
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

    const positions = buildPositions(
      transactions,
      accounts,
      options?.strategy ?? defaultLotStrategy,
    );

    const linesByInstrument = new Map<InstrumentId, AccountPositionLine[]>();
    const order: InstrumentId[] = [];

    for (const position of positions) {
      const account = accountsById.get(position.accountId);
      if (account === undefined) throw new UnknownAccountError(position.accountId);
      if (!instrumentsById.has(position.instrumentId)) {
        throw new UnknownInstrumentError(position.instrumentId);
      }

      if (!linesByInstrument.has(position.instrumentId)) {
        linesByInstrument.set(position.instrumentId, []);
        order.push(position.instrumentId);
      }
      linesByInstrument.get(position.instrumentId)!.push({
        account,
        quantity: position.quantity,
        costBasis: position.costBasis,
        averageCost: averageCostOf(position),
        realized: position.realized,
        lots: position.lots,
      });
    }

    const open: InstrumentPosition[] = [];
    const closed: InstrumentPosition[] = [];

    for (const instrumentId of order) {
      const lines = linesByInstrument.get(instrumentId)!;
      const instrument = instrumentsById.get(instrumentId)!;

      const quantity = lines.reduce((total, line) => total.plus(line.quantity), new Decimal(0));
      const costBasisByCurrency = groupByCurrency(lines.map((line) => line.costBasis));
      const realizedByCurrency = groupByCurrency(lines.map((line) => line.realized));
      const averageCost =
        costBasisByCurrency.length === 1 && !quantity.isZero()
          ? costBasisByCurrency[0]!.amount.dividedBy(quantity)
          : null;

      const instrumentPosition: InstrumentPosition = {
        instrument,
        quantity,
        costBasisByCurrency,
        averageCost,
        realizedByCurrency,
        lines,
      };

      // A fully closed position nets to zero units across every account that
      // held it; a partially closed one still has units open somewhere.
      (quantity.isZero() ? closed : open).push(instrumentPosition);
    }

    const cashBalances: readonly CashBalance[] = buildCashBalances(transactions);
    const cash: CashBalanceLine[] = cashBalances.map((balance) => {
      const account = accountsById.get(balance.accountId);
      if (account === undefined) throw new UnknownAccountError(balance.accountId);
      return { account, amount: balance.amount };
    });

    return { open, closed, cash };
  };
}
