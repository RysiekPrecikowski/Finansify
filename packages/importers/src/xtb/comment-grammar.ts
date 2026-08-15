import Decimal from 'decimal.js';

/**
 * XTB's `Comment` column on a `Stock purchase`/`Stock sell` row:
 * `(OPEN|CLOSE) (BUY|SELL) <qty>[/<total>] @ <price>`.
 *
 * `OPEN`/`CLOSE` and the `BUY`/`SELL` verb describe the *position's own*
 * direction, not this row's — `CLOSE BUY 4 @ 3.32` is a sell that closes a
 * long, and would misread as a purchase if this grammar drove the
 * transaction's type. It does not: the sheet's own `Type` column
 * (`Stock purchase` / `Stock sell`) is the only thing that decides `buy` vs
 * `sell`. This parser exists only to recover `quantity` and the per-unit
 * `price` the comment carries and the `Amount` column does not.
 *
 * `<qty>` is *this row's own* fill, not the position total. XTB splits one
 * logical purchase into several cash-operation rows when it fills in
 * increments — confirmed against real exports: two consecutive rows for the
 * same position, `OPEN BUY 1/1.7554 @ 159.50` (amount −159.50, i.e.
 * `1 × 159.50`) then `OPEN BUY 0.7554/1.7554 @ 159.50` (amount −120.49, i.e.
 * `0.7554 × 159.50`) — the number after `/` is the position's running total
 * after this fill, not this row's quantity, and both rows' own quantity
 * reconciles exactly against their own `Amount`. The total is discarded here;
 * nothing downstream needs a position-level running total this early.
 */
export interface ParsedComment {
  readonly quantity: Decimal;
  readonly price: Decimal;
}

const COMMENT_PATTERN = /^(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([\d.]+)(?:\/[\d.]+)?\s+@\s+([\d.]+)$/;

/** `null` when the comment doesn't match — the caller decides how to warn, this stays a pure parse. */
export function parseTradeComment(comment: string): ParsedComment | null {
  const match = COMMENT_PATTERN.exec(comment.trim());
  if (match === null) return null;

  const [, quantity, price] = match;
  return { quantity: new Decimal(quantity!), price: new Decimal(price!) };
}
