'use client';

import { usePathname } from 'next/navigation';

import { useI18n } from '@/lib/i18n/client';
import { navItems } from '@/lib/nav-items';

/**
 * The header's two stacked lines: which portfolio you are looking at, and
 * which screen of it.
 *
 * It lives in the header rather than in each page because the dashboard
 * redesign folds the wordmark row and the page `<h1>` into a single bar — the
 * app name only appears in the sidebar/drawer now, so the bar carries the
 * screen name instead. Client, because the screen name comes from the
 * pathname; the same `navItems` list the sidebar and the bottom bar render
 * from, so a renamed route is renamed in one place.
 *
 * Not `<h1>`: the page still owns its own heading level, and two `<h1>`s in
 * one document is worse than a heading in the chrome. Pages that dropped their
 * visible title (the dashboard) keep the name here.
 */
export function HeaderTitle() {
  const pathname = usePathname();
  const { dictionary } = useI18n();

  const match = navItems.find((item) => pathname.startsWith(item.href));
  const title = match === undefined ? dictionary.app.name : dictionary.nav[match.labelKey];

  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="text-muted-foreground truncate text-[0.6875rem] font-medium">
        {dictionary.app.portfolioName}
      </span>
      <span className="truncate text-xl font-semibold tracking-tight">{title}</span>
    </div>
  );
}
