'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navItems } from '@/lib/nav-items';
import { useI18n } from '@/lib/i18n/client';

export function BottomNav() {
  const pathname = usePathname();
  const { dictionary } = useI18n();

  return (
    <nav className="bg-background fixed inset-x-0 bottom-0 z-10 flex border-t md:hidden">
      {navItems.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-xs',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <item.icon className="size-5" />
            {dictionary.nav[item.labelKey]}
          </Link>
        );
      })}
    </nav>
  );
}
