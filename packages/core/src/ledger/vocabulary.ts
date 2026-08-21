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

/**
 * `bond` is retail treasury only — subscribed and redeemed through the
 * Ministry, never traded, valued by `accrueBond`'s accrual engine (ADR 0011).
 * `catalyst_bond` is a different product wearing a similar name: a
 * corporate/municipal bond continuously traded on GPW's Catalyst market, with
 * a real market price (quoted as a percentage of nominal) instead of a
 * published rate table. Splitting the kind, rather than branching on the
 * symbol's shape inside one `bond` kind, is what lets `buildPositions` and
 * `valuePositions` route each to its own valuation path without either
 * accidentally falling through to the other's (ADR 0023).
 */
export const instrumentKinds = ['equity', 'etf', 'fund', 'bond', 'catalyst_bond'] as const;
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

/**
 * `import_batches.status`. Deliberately tracks only what `import_rows` cannot
 * answer on its own — whether the parse itself succeeded — not review
 * progress: "does this batch still have unreviewed rows" is a `COUNT(*)
 * WHERE status = 'pending'` over `import_rows`, and storing a second, syncable
 * copy of that fact here is exactly the derived-state duplication ADR 0003
 * exists to avoid. `pending` covers the moment between the batch row being
 * created (so a failed upload still has a record to show) and `parse()`
 * resolving.
 */
export const importBatchStatuses = ['pending', 'parsed', 'failed'] as const;
export type ImportBatchStatus = (typeof importBatchStatuses)[number];

/** `import_rows.status`. See `docs/domain.md`'s "Imports" section. */
export const importRowStatuses = ['pending', 'accepted', 'rejected', 'duplicate'] as const;
export type ImportRowStatus = (typeof importRowStatuses)[number];
