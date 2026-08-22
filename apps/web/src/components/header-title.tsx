'use client';

import { usePathname } from 'next/navigation';

import { useI18n } from '@/lib/i18n/client';
import { drawerScreens, navItems } from '@/lib/nav-items';

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

  // Both lists, because not every screen is a tab: `/allocation` is reached
  // from the drawer only, and falling through to the app name there would
  // leave the bar reading "Finansify" on a screen that has a perfectly good
  // name of its own. Tabs win when a path is in both.
  const tab = navItems.find((item) => pathname.startsWith(item.href));
  const screen = drawerScreens.find((item) => item.href !== null && pathname.startsWith(item.href));

  const title =
    tab !== undefined
      ? dictionary.nav[tab.labelKey]
      : screen !== undefined
        ? dictionary.drawer.screens[screen.headerLabelKey ?? screen.labelKey]
        : dictionary.app.name;

  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="text-muted-foreground truncate text-[0.6875rem] font-medium">
        {dictionary.app.portfolioName}
      </span>
      <span className="truncate text-xl font-semibold tracking-tight">{title}</span>
    </div>
  );
}
