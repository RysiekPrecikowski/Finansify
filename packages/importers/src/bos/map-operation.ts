import Decimal from 'decimal.js';
import {
  Money,
  type ParsedInstrumentCandidate,
  type ParsedRow,
  type TransactionType,
} from '@finansify/core';

import { type BosRow } from './csv-rows';
import { parseBuyDetail, parseDividendTicker } from './detail-grammar';

const DEPOSIT_TITLE = 'Przelew do DM BOŚ';
const BUY_TITLE = 'Rozliczenie transakcji kupna:';
const EXCHANGE_TITLE_PREFIX = 'Wymiana waluty ';

function cashOnlyRow(
  row: BosRow,
  externalId: string,
  type: TransactionType,
  instrument: ParsedInstrumentCandidate | null = null,
  warnings: readonly string[] = [],
): ParsedRow {
  return {
    externalId,
    instrument,
    type,
    tradeDate: row.date,
    settleDate: null,
    quantity: new Decimal(0),
    price: null,
    grossAmount: Money.of(row.amount.abs(), row.currency),
    fee: Money.zero(row.currency),
    tax: Money.zero(row.currency),
    currency: row.currency,
    fxRate: null,
    fxRateSource: null,
    note: row.title,
    warnings,
  };
}

/**
 * `kwota` is the settled amount, commission already netted in — confirmed
 * against a real account's own separate commission report (`hisPW.csv`-style
 * export): quantity × price plus a per-trade commission equals `kwota`
 * exactly, with no rounding gap. This export alone never breaks that figure
 * back out, so `fee` stays zero and `grossAmount` (the settled `kwota`) is
 * what actually left the account — the same "grossAmount wins over quantity
 * × price" precedence `ParsedRow.grossAmountHint` already documents. The
 * difference between `kwota` and quantity × price, when nonzero, becomes a
 * warning naming the implied commission, rather than a silently swallowed
 * number.
 */
function mapBuy(row: BosRow, externalId: string): ParsedRow {
  const detail = parseBuyDetail(row.details);
  if (detail === null) {
    return cashOnlyRow(row, externalId, 'buy', null, [
      `Could not parse the trade detail "${row.details}" — imported as a cash-only buy with no instrument or quantity. Edit by hand.`,
    ]);
  }

  const instrument: ParsedInstrumentCandidate = {
    symbol: detail.name,
    exchange: null,
    name: detail.name,
    isin: detail.isin,
  };

  const impliedTotal = detail.quantity.times(detail.price);
  const settled = row.amount.abs();
  const warnings: string[] = [];
  if (!impliedTotal.equals(settled)) {
    const commission = settled.minus(impliedTotal);
    warnings.push(
      `Settled amount (${settled.toString()} ${row.currency}) differs from quantity × price ` +
        `(${impliedTotal.toString()} ${detail.priceCurrency}) by ${commission.toString()} — ` +
        'likely commission, not broken out separately in this export.',
    );
  }

  return {
    externalId,
    instrument,
    type: 'buy',
    tradeDate: row.date,
    settleDate: null,
    quantity: detail.quantity,
    price: Money.of(detail.price, detail.priceCurrency),
    grossAmount: Money.of(settled, row.currency),
    fee: Money.zero(row.currency),
    tax: Money.zero(row.currency),
    currency: row.currency,
    fxRate: null,
    fxRateSource: null,
    note: row.details,
    warnings,
  };
}

function mapDividend(row: BosRow, externalId: string): ParsedRow {
  const ticker = parseDividendTicker(row.title);
  const instrument: ParsedInstrumentCandidate | null =
    ticker === null ? null : { symbol: ticker, exchange: null, name: null, isin: null };
  return cashOnlyRow(row, externalId, 'dividend', instrument);
}

/**
 * A `Wymiana waluty` operation is two lines, same date, same title, one per
 * currency — the leg paying out (negative) and the leg received (positive).
 * Each line already carries its own currency and amount, so no pairing
 * across lines is needed the way XTB's eWallet pairing was investigated and
 * dropped (ADR 0015): mapped independently, one leg at a time, exactly the
 * shape ADR 0021 relies on — `transfer_in`/`transfer_out` with
 * `instrumentId: null` is a pure cash movement in `buildCashBalances`, never
 * touching the position engine.
 */
function mapExchangeLeg(row: BosRow, externalId: string): ParsedRow {
  const type: TransactionType = row.amount.isPositive() ? 'transfer_in' : 'transfer_out';
  return cashOnlyRow(row, externalId, type);
}

/**
 * Anything outside the four titles confirmed against two real accounts
 * (deposit, buy, dividend, currency exchange) — including a sell, which
 * neither account examined ever exercised. Never dropped, never guessed into
 * a type that implies investment income or a fee it might not be: the
 * least-committal cash movement the amount's sign supports, with the raw
 * title carried in the warning so nothing is lost and the user can
 * reclassify (ADR 0015: "a statement a parser cannot fully explain is not a
 * bug to route around").
 */
function mapUnrecognized(row: BosRow, externalId: string): ParsedRow {
  const type: TransactionType = row.amount.isPositive() ? 'deposit' : 'withdrawal';
  return cashOnlyRow(row, externalId, type, null, [
    `DM BOŚ operation "${row.title}" has no specific mapping; imported as a ${type} by the amount's sign. Verify and reclassify if needed.`,
  ]);
}

export function mapBosRow(row: BosRow, externalId: string): ParsedRow | null {
  if (row.amount.isZero()) return null;

  if (row.title === DEPOSIT_TITLE) return cashOnlyRow(row, externalId, 'deposit');
  if (row.title === BUY_TITLE) return mapBuy(row, externalId);
  if (row.title.startsWith('Wypłata dywidendy brutto ')) return mapDividend(row, externalId);
  if (row.title.startsWith(EXCHANGE_TITLE_PREFIX)) return mapExchangeLeg(row, externalId);

  return mapUnrecognized(row, externalId);
}
