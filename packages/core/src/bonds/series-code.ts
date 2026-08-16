import { Temporal } from '../time';
import {
  bondSeriesCodeSchema,
  isBondFamily,
  type BondSeriesCode,
  type ParsedSeriesCode,
} from './types';

export class InvalidSeriesCodeError extends Error {
  constructor(value: string, reason: string) {
    super(`"${value}" is not a bond series code — ${reason}`);
    this.name = 'InvalidSeriesCodeError';
  }
}

/**
 * Two-digit years are unambiguous in practice: retail treasury bonds started in
 * the 1990s and the longest tenor is ROD's twelve years, so no code in
 * circulation names a year outside 2000–2099. A pivot would be inventing a
 * problem that does not exist until 2099.
 */
const CENTURY = '20';

/**
 * `EDO0836` → the EDO family, redeeming in August 2036.
 *
 * The code names the **redemption** month, which is what the Ministry's own
 * explanation on each offer page says ("08 - miesiąc wykupu, 36 - rok wykupu").
 * It deliberately does not tell you the issue date: several purchase dates
 * within the sale month share one code, and each holder's interest periods run
 * from their own settlement date. `redemptionDateFor` does that derivation,
 * from the purchase, not from the code.
 *
 * The month/year go through `Temporal.PlainYearMonth.from` as a string rather
 * than through `parseInt` — rule 1 bans numeric parsing in this package, and
 * Temporal rejects `…-13` for free, so there is nothing to validate by hand.
 */
export function parseSeriesCode(value: string): ParsedSeriesCode {
  const normalized = value.trim().toUpperCase();
  const code = bondSeriesCodeSchema.safeParse(normalized);
  if (!code.success) {
    throw new InvalidSeriesCodeError(value, 'expected three letters then MMYY');
  }

  const family = normalized.slice(0, 3);
  if (!isBondFamily(family)) {
    throw new InvalidSeriesCodeError(
      value,
      `"${family}" is not a family Finansify issues rules for`,
    );
  }

  const month = normalized.slice(3, 5);
  const year = normalized.slice(5, 7);
  let redemptionMonth: Temporal.PlainYearMonth;
  try {
    redemptionMonth = Temporal.PlainYearMonth.from(`${CENTURY}${year}-${month}`);
  } catch {
    throw new InvalidSeriesCodeError(value, `"${month}" is not a month`);
  }

  return { code: code.data as BondSeriesCode, family, redemptionMonth };
}

/**
 * When a specific holding redeems: the settlement date plus the family tenor.
 *
 * Anchored on the purchase rather than on the series code because that is how
 * the instrument actually behaves — the code carries only a month and a year,
 * while a bond bought on the 31st redeems on the 31st. `Temporal`'s default
 * `constrain` overflow does the right thing for the short-month case (31 August
 * plus one month is 30 September), which is exactly the case the published ROR
 * table exercises.
 */
export function redemptionDateFor(
  settledOn: Temporal.PlainDate,
  tenorMonths: number,
): Temporal.PlainDate {
  return settledOn.add({ months: tenorMonths });
}
