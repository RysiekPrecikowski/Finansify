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
    // The one shadow in the app: everywhere else, depth comes from surface
    // layering, not elevation (docs/ui.md, "borders over shadows") — a
    // floating bar sitting over page content is the one place that layering
    // alone can't sell, so it earns the exception.
    <nav
      className="bg-card fixed inset-x-3 bottom-3 z-10 flex justify-between gap-1 rounded-full px-2 py-1.5 shadow-lg shadow-black/10 md:hidden"
      style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
    >
      {navItems.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[0.6875rem] font-medium transition-colors',
              active ? 'text-foreground bg-muted' : 'text-muted-foreground',
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
