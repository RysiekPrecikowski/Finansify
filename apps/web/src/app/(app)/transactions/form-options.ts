import {
  instrumentId as toInstrumentId,
  transactionShapeOf,
  transactionTypes,
  type UserId,
} from '@finansify/core';

import {
  type TransactionFormAccount,
  type TransactionShapeOfType,
} from '@/components/transactions/transaction-form';
import { getInstruments, scopedLedgerFor } from '@/server/container';

export interface TransactionFormOptions {
  readonly accounts: readonly TransactionFormAccount[];
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
 *
 * No instrument list here anymore: `<InstrumentCombobox>` searches on demand
 * against `app/api/instruments/search` instead of the form preloading every
 * instrument in the database to build a dropdown. `loadSelectedInstrument`
 * below is the only instrument lookup this route makes, and only for editing
 * a transaction that already has one.
 */
export async function loadTransactionFormOptions(userId: UserId): Promise<TransactionFormOptions> {
  const accounts = await scopedLedgerFor(userId).listAccounts();

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
    })),
    shapes: Object.fromEntries(
      transactionTypes.map((type) => [type, transactionShapeOf(type)]),
    ) as Record<string, TransactionShapeOfType>,
  };
}

/** The one instrument lookup `/transactions/[id]/edit` needs — to seed the combobox's initial label, not to build a list. */
export async function loadSelectedInstrument(
  instrumentId: string | null,
): Promise<{ readonly id: string; readonly label: string } | null> {
  if (instrumentId === null) return null;
  const instrument = await getInstruments().findById(toInstrumentId(instrumentId));
  if (instrument === null) return null;
  return { id: instrument.id, label: `${instrument.symbol} · ${instrument.name}` };
}
