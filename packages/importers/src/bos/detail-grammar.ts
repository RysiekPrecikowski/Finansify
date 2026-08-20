import Decimal from 'decimal.js';
import { currency, type Currency } from '@finansify/core';

/**
 * `szczegóły` on a `Rozliczenie transakcji kupna:` row, confirmed against 55
 * real rows across two accounts — always exactly
 * `<name> (<ISIN>) <qty> x <price> <currency> nr <reference>`, with a
 * dot-decimal price (unlike `kwota`'s comma-decimal) and no exceptions in
 * either account examined. `name` doubles as `ParsedInstrumentCandidate.name`
 * and `.symbol`: BOŚ gives no separate ticker field at all, sometimes a short
 * code (`ETFSP500`), sometimes the fund's full name (`Vanguard FTSE
 * All-World UCITS ETF`) — `isin` (PR2's auto-match key) is what actually
 * resolves it, not this string.
 */
export interface BuyDetail {
  readonly name: string;
  readonly isin: string;
  readonly quantity: Decimal;
  readonly price: Decimal;
  readonly priceCurrency: Currency;
  readonly reference: string;
}

const BUY_DETAIL_PATTERN =
  /^(.+) \(([A-Z]{2}[A-Z0-9]{9}\d)\) (\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) ([A-Z]{3}) nr (\S+)$/;

export function parseBuyDetail(details: string): BuyDetail | null {
  const match = BUY_DETAIL_PATTERN.exec(details);
  if (match === null) return null;
  const [, name, isin, quantity, price, priceCurrency, reference] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  try {
    return {
      name,
      isin,
      quantity: new Decimal(quantity),
      price: new Decimal(price),
      priceCurrency: currency(priceCurrency),
      reference,
    };
  } catch {
    return null;
  }
}

const KNOWN_CURRENCY_SUFFIX = /^(.+) ([A-Z]{3})$/;

/**
 * `Wypłata dywidendy brutto <ticker>[ <currency>]` — the trailing currency
 * qualifier appears only for a foreign-listed fund (`VGWL EUR`, `VWRL EUR`);
 * a PLN-account dividend on a domestically-listed fund carries no qualifier
 * at all (`ETFSP500`). The ticker here does not match `parseBuyDetail`'s
 * `name` for the same holding — BOŚ gives no ISIN on a dividend row, so this
 * candidate resolves separately, the same way an XTB dividend row resolves
 * independently of that ticker's buy rows (rule: never invent a link the
 * export itself doesn't state).
 */
const DIVIDEND_TITLE_PREFIX = 'Wypłata dywidendy brutto ';

export function parseDividendTicker(title: string): string | null {
  if (!title.startsWith(DIVIDEND_TITLE_PREFIX)) return null;
  const rest = title.slice(DIVIDEND_TITLE_PREFIX.length).trim();
  if (rest.length === 0) return null;

  const withSuffix = KNOWN_CURRENCY_SUFFIX.exec(rest);
  if (withSuffix !== null) {
    const [, ticker] = withSuffix as unknown as [string, string, string];
    return ticker;
  }
  return rest;
}
