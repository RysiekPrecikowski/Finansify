import { grossValueOf, type InstrumentId, type Transaction } from '@finansify/core';
import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatMoney, formatPlainDate } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';

/**
 * The instrument a row refers to, or an em-dash for a pure cash movement.
 *
 * This used to fall back to `transaction.quantity` whenever `instrumentId` was
 * `null`, which is a bug rather than a fallback. `instrumentId` is null exactly
 * for "pure cash movements: a deposit references no instrument"
 * (`packages/core/src/ledger/types.ts`), and `quantity` carries no meaning for
 * those rows: nothing meaningful sets it, `grossValueOf` never reads it for
 * them (their `price` is null, so the stored `grossAmount` wins), and
 * `buildCashBalances` ignores it entirely. The result was a bare, unlabelled
 * figure under a column headed "Instrument" — a 10 000 zł deposit rendered a
 * "0" beside it, which reads as a quantity of something rather than as the
 * absence of an instrument.
 *
 * A deposit has no instrument, and the honest rendering of "there is no value
 * here" is a dash, not whatever integer happens to sit in an unused column.
 */
export function instrumentLabel(
  transaction: Transaction,
  symbolOf: ReadonlyMap<InstrumentId, string>,
): string {
  if (transaction.instrumentId === null) return '—';
  return symbolOf.get(transaction.instrumentId) ?? '—';
}

/**
 * The transaction type, as the same neutral `outline` badge the wrapper badges
 * use — never a colour. A transaction is neither a gain nor a loss, and green
 * and red are reserved for P&L (`docs/ui.md`); with fifteen types in this
 * domain the badge is there for scannability, not for meaning.
 */
export function TypeBadge({
  transaction,
  strings,
}: Readonly<{ transaction: Transaction; strings: Dictionary['transactions'] }>) {
  return (
    <Badge variant="outline" className="text-muted-foreground tracking-wider uppercase">
      {strings.types[transaction.type]}
    </Badge>
  );
}

/**
 * One transaction as the phone card the canvas artboard specifies: trade date
 * over type-and-account on the left, gross value over instrument on the right,
 * the whole card a link into the edit form. Rendered through
 * `<DataList mobileCard>`, so the desktop `<table>` still comes from the page's
 * own column definitions.
 */
export function TransactionRow({
  transaction,
  accountLabel,
  symbolOf,
  locale,
  strings,
}: Readonly<{
  transaction: Transaction;
  accountLabel: string;
  symbolOf: ReadonlyMap<InstrumentId, string>;
  locale: Locale;
  strings: Dictionary['transactions'];
}>) {
  return (
    <Link
      href={`/transactions/${transaction.id}/edit` as Route}
      className="bg-card hover:bg-muted/50 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 transition-colors"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-sm font-semibold">
          {formatPlainDate(transaction.tradeDate, locale)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <TypeBadge transaction={transaction} strings={strings} />
          <span className="text-muted-foreground truncate text-[0.6875rem]">{accountLabel}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">
          {formatMoney(grossValueOf(transaction), locale)}
        </span>
        <span className="text-muted-foreground text-[0.6875rem]">
          {instrumentLabel(transaction, symbolOf)}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}
