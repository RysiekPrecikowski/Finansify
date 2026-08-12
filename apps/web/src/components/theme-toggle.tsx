'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { dictionary } = useI18n();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dictionary.actions.toggleTheme}
      // Both icons occupy the same grid cell, so the swap needs no absolute
      // positioning — which had nothing to position against and escaped the button.
      className={cn('grid place-items-center [&>svg]:col-start-1 [&>svg]:row-start-1', className)}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="size-4 scale-100 transition-transform dark:scale-0" />
      <Moon className="size-4 scale-0 transition-transform dark:scale-100" />
    </Button>
  );
}
