'use server';

import { makeSetInstrumentChain } from '@finansify/core';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { getInstruments, getSymbols } from '@/server/container';

export interface ChainEntryInput {
  readonly provider: string;
  readonly symbol: string;
}

export interface SetChainOutcome {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * The identity check gates *who may call this at all* — there is no
 * ownership to enforce beyond that, unlike a transaction's `scopedLedgerFor`
 * (rule 4): `instrument_identifiers` is global (ADR 0010), so any
 * authenticated user of this shared instance may edit it, the same way both
 * of us can already see every instrument and price.
 */
export async function setInstrumentChainAction(
  instrumentId: string,
  entries: readonly ChainEntryInput[],
): Promise<SetChainOutcome> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const setInstrumentChain = makeSetInstrumentChain({
    instruments: getInstruments(),
    symbols: getSymbols(),
  });

  const result = await setInstrumentChain({ instrumentId, entries });
  if (!result.ok) {
    return { ok: false, error: result.issues[0]?.message ?? 'Invalid input' };
  }

  revalidatePath('/more/providers');
  revalidatePath(`/more/providers/${instrumentId}`);
  return { ok: true };
}
