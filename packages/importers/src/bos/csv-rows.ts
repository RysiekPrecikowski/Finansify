import Decimal from 'decimal.js';
import { currency, Temporal, type Currency } from '@finansify/core';

import { bosDataLines } from './layout';

/** One line of the export, split and typed, but not yet interpreted by operation title. */
export interface BosRow {
  readonly date: Temporal.PlainDate;
  readonly title: string;
  /** `szczegóły` — populated only on a `Rozliczenie transakcji kupna:` row; empty string otherwise. */
  readonly details: string;
  /** Signed, exactly as the column reports it — direction lives in the amount's sign, same as XTB. */
  readonly amount: Decimal;
  readonly currency: Currency;
  /** The line's own position in the file, data rows only — see `external-id.ts` for why this matters. */
  readonly lineIndex: number;
}

/**
 * `kwota` uses a comma decimal separator (`-1197,40`) — a plain Polish
 * locale number, not the dot-decimal seen inside `szczegóły`'s embedded
 * price (`299.35 PLN`). `Decimal` parses the string directly; nothing here
 * ever goes through `Number()`/`parseFloat` (rule 1).
 */
function parsePolishDecimal(raw: string): Decimal {
  return new Decimal(raw.replace(',', '.'));
}

/**
 * A line that doesn't split into exactly five fields, or whose date/amount/
 * currency doesn't parse, is not a shape any real export has shown — treated
 * the same way XTB treats a `Cash Operations` row missing `Time`/`Amount`/
 * `ID`: skipped as a stray artifact rather than surfaced as data, since
 * `readBosRows` has no per-line warning channel of its own (`parse()` builds
 * per-row warnings once it knows the operation, not while still splitting
 * lines).
 */
export function readBosRows(text: string): readonly BosRow[] {
  const rows: BosRow[] = [];
  let lineIndex = 0;

  for (const line of bosDataLines(text)) {
    const fields = line.split(';');
    if (fields.length !== 5) continue;
    const [dateRaw, title, details, amountRaw, currencyRaw] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];

    let date: Temporal.PlainDate;
    let amount: Decimal;
    let rowCurrency: Currency;
    try {
      date = Temporal.PlainDate.from(dateRaw);
      amount = parsePolishDecimal(amountRaw);
      rowCurrency = currency(currencyRaw);
    } catch {
      continue;
    }
    if (amount.isNaN()) continue;

    rows.push({ date, title, details, amount, currency: rowCurrency, lineIndex });
    lineIndex += 1;
  }

  return rows;
}
