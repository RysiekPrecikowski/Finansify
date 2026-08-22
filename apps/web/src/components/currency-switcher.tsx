'use client';

import { useTransition } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setDisplayLines, setDisplayTotal } from '@/lib/display/actions';
import { displayCurrencies, type DisplaySettings } from '@/lib/display/currencies';
import { useI18n } from '@/lib/i18n/client';

/**
 * Presentation currency, beside the locale switcher and shaped like it. The
 * settings arrive as a prop rather than from a context: the layout already
 * reads the cookie on the server, and a second provider for two strings would
 * be ceremony.
 *
 * One control, two settings — the currency list sets the total, the checkbox
 * says whether the per-position figures follow it or stay in the instrument's
 * own currency. They are separate because the useful reading is a total in
 * your currency over positions still in theirs.
 */
export function CurrencySwitcher({ settings }: Readonly<{ settings: DisplaySettings }>) {
  const { dictionary } = useI18n();
  const strings = dictionary.actions;
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // Filled, not ghost: this is the only control in the header that
          // changes every number on the page, and it reads as a value you
          // picked ("PLN ⌄") rather than as an icon you might press.
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            aria-label={strings.changeCurrency}
            className="gap-1 rounded-full pr-1.5"
          >
            <span className="text-xs font-medium">{settings.total}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {displayCurrencies.map((code) => (
          <DropdownMenuItem
            key={code}
            disabled={code === settings.total}
            onClick={() => {
              startTransition(async () => {
                await setDisplayTotal(code);
              });
            }}
          >
            {code}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={settings.lines === 'native'}
          onCheckedChange={(checked) => {
            startTransition(async () => {
              await setDisplayLines(checked ? 'native' : 'total');
            });
          }}
        >
          {strings.nativeLines}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* Not a choice, which is exactly why it is stated. A portfolio total
            is converted at the NBP mid and nothing else: Polish tax uses the
            NBP rate from the business day before a transaction, so the book and
            the return have to agree (ADR 0017). The market rate a reader might
            compare against lives on `/indicators`, labelled as such. */}
        <p className="text-muted-foreground px-2 py-1.5 text-xs">{strings.currencySource}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
