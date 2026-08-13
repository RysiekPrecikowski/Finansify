import Decimal from 'decimal.js';
import { z } from 'zod';

import { Money, type Currency } from '../money';
import { Temporal } from '../time';

// The closed value lists live in `./vocabulary`, which imports nothing at all —
// `packages/db` reaches them through `@finansify/core/vocabulary` so that
// drizzle-kit never has to load Temporal. Re-exported here so every other
// caller sees one ledger module.
export * from './vocabulary';
import {
  fxRateSources,
  transactionTypes,
  wrappers,
  type FxRateSource,
  type InstrumentKind,
  type TransactionSource,
  type TransactionType,
  type Wrapper,
} from './vocabulary';

/**
 * Ids are branded for the same reason `UserId` is (ADR 0009): an account id and
 * an instrument id are both UUID strings, and nothing but the type system stops
 * one being passed where the other belongs.
 */
export const accountIdSchema = z.string().uuid().brand<'AccountId'>();
export type AccountId = z.infer<typeof accountIdSchema>;
export const accountId = (value: string): AccountId => accountIdSchema.parse(value);

export const portfolioIdSchema = z.string().uuid().brand<'PortfolioId'>();
export type PortfolioId = z.infer<typeof portfolioIdSchema>;
export const portfolioId = (value: string): PortfolioId => portfolioIdSchema.parse(value);

export const instrumentIdSchema = z.string().uuid().brand<'InstrumentId'>();
export type InstrumentId = z.infer<typeof instrumentIdSchema>;
export const instrumentId = (value: string): InstrumentId => instrumentIdSchema.parse(value);

export const transactionIdSchema = z.string().uuid().brand<'TransactionId'>();
export type TransactionId = z.infer<typeof transactionIdSchema>;
export const transactionId = (value: string): TransactionId => transactionIdSchema.parse(value);

export interface Account {
  readonly id: AccountId;
  readonly name: string;
  readonly broker: string;
  readonly wrapper: Wrapper;
  /** The currency of this account's cash balance — not the instruments'. */
  readonly currency: Currency;
  readonly openedAt: Temporal.PlainDate;
  readonly closedAt: Temporal.PlainDate | null;
}

export interface Portfolio {
  readonly id: PortfolioId;
  readonly name: string;
  readonly accountIds: readonly AccountId[];
}

/** Global and unscoped: instruments describe the world, not a user. */
export interface Instrument {
  readonly id: InstrumentId;
  readonly kind: InstrumentKind;
  readonly isin: string | null;
  readonly symbol: string;
  readonly exchange: string | null;
  readonly currency: Currency;
  readonly name: string;
}

/**
 * One row of the ledger. Money is `Money`, quantities are `Decimal`, dates are
 * `PlainDate` — a trade date is a calendar day, and storing it as an instant is
 * how trade dates acquire a timezone bug (ADR 0007).
 *
 * Every monetary field carries `currency`, the **transaction** currency, which
 * is not necessarily the account's. When they differ, `fxRate` holds the rate
 * as actually executed — never reconstructed later (rule 6, ADR 0006).
 */
export interface Transaction {
  readonly id: TransactionId;
  readonly accountId: AccountId;
  /** `null` for pure cash movements: a deposit references no instrument. */
  readonly instrumentId: InstrumentId | null;
  readonly type: TransactionType;
  readonly tradeDate: Temporal.PlainDate;
  readonly settleDate: Temporal.PlainDate | null;
  readonly quantity: Decimal;
  /** Per unit. `null` for rows that have no unit price, such as a deposit. */
  readonly price: Money | null;
  /**
   * What the broker actually charged or paid, before fees. Authoritative when
   * present — see `costBasisOf`.
   */
  readonly grossAmount: Money | null;
  readonly fee: Money;
  readonly tax: Money;
  readonly currency: Currency;
  readonly fxRate: Decimal | null;
  readonly fxRateSource: FxRateSource | null;
  readonly source: TransactionSource;
  readonly externalId: string | null;
  readonly importBatchId: string | null;
  readonly editedAfterImport: boolean;
  /** Specific-lot selection on a sell; `null` means the strategy default. */
  readonly matchedLotIds: readonly TransactionId[] | null;
  readonly note: string | null;
}

/**
 * The gross value of a transaction's own leg.
 *
 * `grossAmount` wins whenever it is present, because it is what the broker
 * actually moved — `quantity × price` is a reconstruction, and the two disagree
 * by a grosz or two the moment a broker rounds. Picking one and saying so is
 * the difference between a cost basis that is right and one that drifts.
 */
export function grossValueOf(transaction: Transaction): Money {
  if (transaction.grossAmount !== null) return transaction.grossAmount;
  if (transaction.price !== null) return transaction.price.times(transaction.quantity);
  return Money.zero(transaction.currency);
}

/**
 * What a purchase actually cost: the gross plus the fee that was paid to make
 * it happen. Tax is deliberately excluded — Polish investment tax is settled on
 * realized gains, not folded into the basis of an open lot.
 */
export function costBasisOf(transaction: Transaction): Money {
  return grossValueOf(transaction).plus(transaction.fee);
}

/** What a sale actually returned: gross less the costs of selling. */
export function netProceedsOf(transaction: Transaction): Money {
  return grossValueOf(transaction).minus(transaction.fee).minus(transaction.tax);
}

const decimalString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      return new Decimal(value).isFinite();
    } catch {
      return false;
    }
    // `Number()` is never involved: `Decimal` parses the string itself, which is
    // the whole point of rule 1.
  }, 'Must be a finite decimal number');

const plainDateString = z.string().refine((value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
}, 'Must be a calendar date, as YYYY-MM-DD');

/**
 * What a caller may submit to create a transaction. Deliberately strings rather
 * than `Money` and `Decimal`: this is the shape a form produces, and parsing it
 * here is what keeps `Number()` out of the app edge as well as out of `core`.
 */
export const transactionInputSchema = z.object({
  accountId: accountIdSchema,
  instrumentId: instrumentIdSchema.nullable().default(null),
  type: z.enum(transactionTypes),
  tradeDate: plainDateString,
  settleDate: plainDateString.nullable().default(null),
  quantity: decimalString,
  price: decimalString.nullable().default(null),
  grossAmount: decimalString.nullable().default(null),
  fee: decimalString.default('0'),
  tax: decimalString.default('0'),
  currency: z.string(),
  fxRate: decimalString.nullable().default(null),
  fxRateSource: z.enum(fxRateSources).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;

/**
 * The account's currency is not on the transaction, so rule 6 cannot be a plain
 * schema refinement — it needs to know what the money is being converted *to*.
 * Building the schema against a known account makes the requirement structural
 * at the one place a transaction is created.
 *
 * A broker converts at its own spread, so there is no defensible rate to
 * default to here. Refusing the row is the honest answer; inventing a rate
 * would silently corrupt cost basis and realized P&L forever.
 */
export function transactionInputSchemaFor(accountCurrency: Currency) {
  return transactionInputSchema.superRefine((input, context) => {
    const sameCurrency = input.currency.toUpperCase() === accountCurrency;

    if (sameCurrency) return;

    if (input.fxRate === null) {
      context.addIssue({
        code: 'custom',
        path: ['fxRate'],
        message: `A transaction in ${input.currency} on a ${accountCurrency} account needs the rate as executed`,
      });
    }
    if (input.fxRateSource === null) {
      context.addIssue({
        code: 'custom',
        path: ['fxRateSource'],
        message: 'Record where the executed rate came from',
      });
    }
  });
}

export interface AccountInput {
  readonly name: string;
  readonly broker: string;
  readonly wrapper: Wrapper;
  readonly currency: Currency;
  readonly openedAt: Temporal.PlainDate;
}

export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  broker: z.string().trim().min(1).max(120),
  wrapper: z.enum(wrappers),
  currency: z.string(),
  openedAt: plainDateString,
});
