import { z } from 'zod';

import { CURRENCY_CODES } from './money';
import { TRANSACTION_TYPES } from './ledger';

/**
 * Every write crossing the network is validated against a schema in this file.
 * Server actions and route handlers parse here; the client reuses the same schema
 * for form validation so the two can never drift.
 */

export const currencyCodeSchema = z.enum(CURRENCY_CODES);

/** Money arrives as a decimal string, never a number. See docs/domain.md. */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number, e.g. "1234.56"');

export const nameSchema = z.string().trim().min(1).max(120);

export const accountWrapperSchema = z.enum(['TAXABLE', 'IKE', 'IKZE', 'PPK']);

export const createPortfolioSchema = z.object({
  name: nameSchema,
  baseCurrency: currencyCodeSchema,
});
export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;

export const createAccountSchema = z.object({
  name: nameSchema,
  baseCurrency: currencyCodeSchema,
  wrapper: accountWrapperSchema.default('TAXABLE'),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const linkAccountSchema = z.object({
  portfolioId: z.uuid(),
  accountId: z.uuid(),
});
export type LinkAccountInput = z.infer<typeof linkAccountSchema>;

export const createTransactionSchema = z.object({
  accountId: z.uuid(),
  type: z.enum(TRANSACTION_TYPES),
  occurredAt: z.iso.datetime(),
  amount: decimalStringSchema,
  currency: currencyCodeSchema,
  fxRateToAccountCurrency: decimalStringSchema,
  instrumentId: z.uuid().optional(),
  quantity: decimalStringSchema.optional(),
  note: z.string().max(500).optional(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export type PaginationInput = z.infer<typeof paginationSchema>;
