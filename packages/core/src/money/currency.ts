import { z } from 'zod';

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code')
  .brand<'Currency'>();

export type Currency = z.infer<typeof currencySchema>;

export function currency(code: string): Currency {
  return currencySchema.parse(code.toUpperCase());
}
