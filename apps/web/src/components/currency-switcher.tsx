'use client';

import { useTransition } from 'react';
import { Coins } from 'lucide-react';

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
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={strings.changeCurrency}
            className="gap-1.5"
          >
            <Coins className="size-4" />
            <span className="text-xs font-medium">{settings.total}</span>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
