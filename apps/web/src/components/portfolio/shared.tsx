import type { Money } from '@finansify/core';

import { directionOf, directionText, formatMoney } from '@/lib/format';
import { type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** No logo provider yet, so a monogram — never a blank circle. */
export function Monogram({ symbol }: Readonly<{ symbol: string }>) {
  return (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold"
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

/**
 * One line per currency — cost basis and realized P&L are never summed across
 * currencies (rule 6/7): inventing a rate to collapse them is exactly what the
 * ledger refuses to do before an explicit FX conversion exists.
 */
export function MoneyLines({
  amounts,
  locale,
  colored = false,
}: Readonly<{ amounts: readonly Money[]; locale: Locale; colored?: boolean }>) {
  return (
    <span className="flex flex-col items-end">
      {amounts.map((amount) => (
        <span
          key={amount.currency}
          className={cn('tabular-nums', colored && directionText[directionOf(amount)])}
        >
          {formatMoney(amount, locale, { signed: colored })}
        </span>
      ))}
    </span>
  );
}
