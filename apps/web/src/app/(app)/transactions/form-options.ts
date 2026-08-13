import { transactionShapeOf, transactionTypes, type UserId } from '@finansify/core';

import {
  type TransactionFormAccount,
  type TransactionFormInstrument,
  type TransactionShapeOfType,
} from '@/components/transactions/transaction-form';
import { getInstruments, scopedLedgerFor } from '@/server/container';

export interface TransactionFormOptions {
  readonly accounts: readonly TransactionFormAccount[];
  readonly instruments: readonly TransactionFormInstrument[];
  readonly shapes: Readonly<Record<string, TransactionShapeOfType>>;
}

/**
 * What both the create and the edit route need, loaded once in one place rather
 * than twice in two (rule 13).
 *
 * The shapes are resolved **here**, on the server, and handed down as plain
 * data. The form needs to know which fields a type uses, but importing
 * `transactionShapeOf` into a client component would pull `ledger/types.ts` —
 * and so Decimal, zod and Temporal — into the browser bundle. `vocabulary.ts`
 * exists for exactly this reason and stays the only part of `core` the form
 * imports directly.
 */
export async function loadTransactionFormOptions(userId: UserId): Promise<TransactionFormOptions> {
  const [accounts, instruments] = await Promise.all([
    scopedLedgerFor(userId).listAccounts(),
    getInstruments().listAll(),
  ]);

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
    })),
    instruments: instruments.map((instrument) => ({
      id: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
    })),
    shapes: Object.fromEntries(
      transactionTypes.map((type) => [type, transactionShapeOf(type)]),
    ) as Record<string, TransactionShapeOfType>,
  };
}
