'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n/client';
import { setLocale } from '@/lib/i18n/actions';
import { locales, localeLabel } from '@/lib/i18n/locales';

export function LocaleSwitcher() {
  const { locale, dictionary } = useI18n();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // Text only, no icon — the canvas's grouped header pill has room
          // for a code, not an icon-plus-code pairing.
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={dictionary.actions.changeLanguage}
            className="text-muted-foreground h-[38px] min-w-10 rounded-full px-1.5"
          >
            <span className="text-xs font-semibold tracking-wide">{localeLabel[locale]}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {locales.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            disabled={candidate === locale}
            onClick={() => {
              startTransition(async () => {
                await setLocale(candidate);
              });
            }}
          >
            {localeLabel[candidate]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
