import Decimal from 'decimal.js';
import {
  Money,
  type Currency,
  type ParsedInstrumentCandidate,
  type ParsedRow,
  type TransactionType,
} from '@finansify/core';

import { type CashOperationRow } from './cash-operations';
import { parseTradeComment } from './comment-grammar';
import { instantToWarsawDate } from './layout';
import { type OpenPositionLot } from './positions';
import { normalizeXtbTicker } from './ticker-suffix';

export interface MapContext {
  readonly accountCurrency: Currency;
  /** From `inferFxRatios` — keyed by ticker, `null` meaning "no conversion detected". */
  readonly fxRatioByTicker: ReadonlyMap<string, Decimal | null>;
}

/**
 * Both net to exactly zero across a real export — confirmed, not assumed:
 * summing every `Subaccount transfer` (and separately every `Transfer`) row
 * in a real statement totals `0.00`. They move cash between buckets *within*
 * the same account (the main balance and an Investment Plan), which is
 * exactly what collapses to a no-op once those buckets aren't modeled as
 * separate accounts (ADR 0015) — not a gap, a verified non-event.
 */
const ZERO_SUM_TYPES = new Set(['Subaccount transfer', 'Transfer']);

const instrumentOf = (ticker: string | null): ParsedInstrumentCandidate | null =>
  ticker === null
    ? null
    : { symbol: normalizeXtbTicker(ticker), exchange: null, name: null, isin: null };

function cashOnlyRow(
  row: CashOperationRow,
  type: TransactionType,
  currency: Currency,
  instrument: ParsedInstrumentCandidate | null = null,
): ParsedRow {
  return {
    externalId: row.id,
    instrument,
    type,
    tradeDate: instantToWarsawDate(row.time),
    settleDate: null,
    quantity: new Decimal(0),
    price: null,
    grossAmount: Money.of(row.amount.abs(), currency),
    fee: Money.zero(currency),
    tax: Money.zero(currency),
    currency,
    fxRate: null,
    fxRateSource: null,
    note: row.comment,
    warnings: [],
  };
}

/**
 * Anything not in the known taxonomy — including a genuinely unrecognized
 * future `Type` and the zero-effect corners of a known one (`Commission`,
 * `Correction`, `Close trade` all read `0.00` in every real occurrence, tied
 * to a stock-split cluster). A zero-amount row has nothing to represent and
 * is dropped; a nonzero one is never dropped silently — it becomes the least-
 * wrong cash movement the amount's sign implies, with a warning that carries
 * the statement's own `Type` and `Comment` verbatim so nothing is lost even
 * though the classification is a guess.
 */
function mapUnrecognized(row: CashOperationRow, currency: Currency): ParsedRow | null {
  if (row.amount.isZero()) return null;

  const type: TransactionType = row.amount.isPositive() ? 'dividend' : 'fee';
  const base = cashOnlyRow(row, type, currency, instrumentOf(row.ticker));
  return {
    ...base,
    warnings: [
      `XTB operation type "${row.type}" has no specific mapping; imported as a ${type} by the amount's sign — comment: "${row.comment}". Verify and reclassify if needed.`,
    ],
  };
}

/**
 * XTB's own `Type` for a stock split's fractional remainder — when a forward
 * split (comment reads `"<ticker> split N for M"`) leaves a fraction that
 * doesn't round to a whole new share, XTB closes it for cash instead of
 * crediting a fractional position. The cash effect is real and known; the
 * quantity closed is not — the comment carries no `@ price`/quantity the way
 * a `Stock purchase`/`Stock sell` comment does, so this takes `mapTrade`'s own
 * "comment didn't parse" shape: the correct transaction type with
 * `quantity: 0` and a warning, never `mapUnrecognized`'s dividend/fee guess by
 * sign, which would book a capital-gain sale as ordinary income.
 */
function mapFractionalShareClose(row: CashOperationRow, currency: Currency): ParsedRow | null {
  if (row.amount.isZero()) return null;

  const type: TransactionType = row.amount.isPositive() ? 'sell' : 'buy';
  const base = cashOnlyRow(row, type, currency, instrumentOf(row.ticker));
  return {
    ...base,
    warnings: [
      `XTB closed a fractional share for cash after a split (comment: "${row.comment}") — imported as a ${type} with the cash amount only; the fractional quantity closed isn't in the export. Adjust the position's quantity by hand if this affects cost basis.`,
    ],
  };
}

/**
 * `Stock purchase`/`Stock sell`. `price` is `grossAmount ÷ quantity` in the
 * *account's* currency, not the comment's own `@ price` — the comment's price
 * is in whatever currency the instrument itself trades in, which can differ
 * from the account (that gap is exactly what the FX ratio measures). Deriving
 * `price` this way keeps `price × quantity == grossAmount` in one currency
 * throughout, rather than mixing a foreign per-unit price with a
 * domestic-currency total on the same row.
 */
function mapTrade(row: CashOperationRow, ctx: MapContext): ParsedRow {
  const currency = ctx.accountCurrency;
  const grossAmount = Money.of(row.amount.abs(), currency);
  const warnings: string[] = [];

  const comment = row.ticker === null ? null : parseTradeComment(row.comment);
  if (comment === null) {
    warnings.push(
      `Could not parse the trade comment "${row.comment}" — quantity is unknown; only the cash amount was imported.`,
    );
    return {
      externalId: row.id,
      instrument: instrumentOf(row.ticker),
      type: row.type === 'Stock purchase' ? 'buy' : 'sell',
      tradeDate: instantToWarsawDate(row.time),
      settleDate: null,
      quantity: new Decimal(0),
      price: null,
      grossAmount,
      fee: Money.zero(currency),
      tax: Money.zero(currency),
      currency,
      fxRate: null,
      fxRateSource: null,
      note: row.comment,
      warnings,
    };
  }

  const fxRatio = row.ticker === null ? null : (ctx.fxRatioByTicker.get(row.ticker) ?? null);
  if (fxRatio !== null) {
    warnings.push(
      `FX rate ${fxRatio.toFixed(4)} inferred from amount ÷ (quantity × price) across this ticker's fills — XTB's export has no explicit rate column. Verify before relying on it for tax purposes (rule 6, ADR 0006).`,
    );
  }

  return {
    externalId: row.id,
    instrument: instrumentOf(row.ticker),
    type: row.type === 'Stock purchase' ? 'buy' : 'sell',
    tradeDate: instantToWarsawDate(row.time),
    settleDate: null,
    quantity: comment.quantity,
    price: Money.of(grossAmount.amount.dividedBy(comment.quantity), currency),
    grossAmount,
    fee: Money.zero(currency),
    tax: Money.zero(currency),
    currency,
    fxRate: fxRatio,
    fxRateSource: fxRatio === null ? null : 'broker',
    note: row.comment,
    warnings,
  };
}

/**
 * Recovers a transaction for a ticker `Cash Operations` has zero evidence for
 * at all but that `parser.ts` has confirmed genuinely sits open — the shape
 * of a spin-off with no cash trace (confirmed against a real account:
 * Synektik's spin-off into Syn2bio never appears on `Cash Operations`, but
 * `Open Positions`' own per-lot table records it as a `BUY` at a near-zero
 * open price). Mapped to `transfer_in`, not `buy` or the lot's own `BUY`/
 * `SELL` marker — nothing here is evidence of a market trade, only that the
 * position exists and when it opened, and `transfer_in` is the type for
 * exactly that (shares arriving without one). `externalId` is built from the
 * lot's own position id, XTB's stable identifier for it, so a re-import dedups
 * exactly as every other row does (rule 4/ADR 0004).
 */
export function mapOpenPositionLot(lot: OpenPositionLot, currency: Currency): ParsedRow {
  return {
    externalId: `xtb-position:${lot.positionId}`,
    instrument: { symbol: lot.ticker, exchange: null, name: null, isin: null },
    type: 'transfer_in',
    tradeDate: instantToWarsawDate(lot.openTime),
    settleDate: null,
    quantity: lot.volume,
    price: Money.of(lot.openPrice, currency),
    grossAmount: Money.of(lot.openPrice.times(lot.volume), currency),
    fee: Money.zero(currency),
    tax: Money.zero(currency),
    currency,
    fxRate: null,
    fxRateSource: null,
    note: null,
    warnings: [
      `No Cash Operations row exists for this position at all — recovered from Open Positions' own record instead (opened ${lot.openTime.toString()}, at ${lot.openPrice.toFixed()} ${currency}/unit). Most likely a spin-off with no cash trace. Review before accepting.`,
    ],
  };
}

export function mapCashOperationRow(row: CashOperationRow, ctx: MapContext): ParsedRow | null {
  const currency = ctx.accountCurrency;

  switch (row.type) {
    case 'Deposit':
      return cashOnlyRow(row, 'deposit', currency);
    case 'Withdrawal':
      return cashOnlyRow(row, 'withdrawal', currency);
    case 'Free funds interest':
      return cashOnlyRow(row, 'interest', currency);
    case 'Free funds interest tax':
      return cashOnlyRow(row, 'tax', currency);
    case 'Dividend':
      return cashOnlyRow(row, 'dividend', currency, instrumentOf(row.ticker));
    case 'Withholding tax':
      return cashOnlyRow(row, 'tax', currency, instrumentOf(row.ticker));
    case 'Stock purchase':
    case 'Stock sell':
      return mapTrade(row, ctx);
    case 'Fractional shares':
      return mapFractionalShareClose(row, currency);
  }

  if (ZERO_SUM_TYPES.has(row.type)) return null;
  return mapUnrecognized(row, currency);
}
