/**
 * The ledger's closed value lists, and **nothing else**.
 *
 * This module is deliberately free of every import — no Temporal, no zod, no
 * `Decimal`. `packages/db` builds its `pgEnum`s from these arrays so the
 * database and the domain cannot drift apart, and drizzle-kit loads the schema
 * through a CJS require hook that cannot resolve `temporal-polyfill`'s ESM-only
 * subpaths. Reaching the vocabulary through the package root would drag the
 * polyfill in and break `db:generate` outright.
 *
 * Keep it dependency-free. `./types` re-exports all of it, so nothing outside
 * `packages/db` needs to know this file exists.
 *
 * `docs/domain.md` is the source for every list here.
 */

export const wrappers = ['brokerage', 'ike', 'ikze', 'ppk'] as const;
export type Wrapper = (typeof wrappers)[number];

export const instrumentKinds = ['equity', 'etf', 'fund', 'bond'] as const;
export type InstrumentKind = (typeof instrumentKinds)[number];

/**
 * All fifteen types exist from the start, so Phase 3 (bonds) and Phase 4
 * (imports) need no migration to start writing rows. Only a subset affects
 * positions or cash today — see `positions/build-positions.ts`.
 */
export const transactionTypes = [
  'buy',
  'sell',
  'dividend',
  'interest',
  'coupon',
  'fee',
  'tax',
  'deposit',
  'withdrawal',
  'transfer_in',
  'transfer_out',
  'split',
  'bond_purchase',
  'bond_redemption',
  'bond_early_redemption',
] as const;
export type TransactionType = (typeof transactionTypes)[number];

export const fxRateSources = ['broker', 'nbp', 'user'] as const;
export type FxRateSource = (typeof fxRateSources)[number];

export const transactionSources = ['manual', 'import'] as const;
export type TransactionSource = (typeof transactionSources)[number];
