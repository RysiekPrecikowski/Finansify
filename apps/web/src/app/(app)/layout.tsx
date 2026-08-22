import type { Route } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/app-sidebar';
import { BottomNav } from '@/components/bottom-nav';
import { CurrencySwitcher } from '@/components/currency-switcher';
import { HeaderTitle } from '@/components/header-title';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { getCurrentUser, UserMenu } from '@/lib/auth';
import { getDisplaySettings } from '@/lib/display/server';

// Second layer, not the only one: src/proxy.ts's matcher is the primary gate,
// but a matcher is routing config, and routing config being the *sole*
// authorization decision is exactly how that gate was bypassable. This layout
// is every route under (app), so checking here means one bug in the matcher
// no longer means an unauthenticated render.
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [user, display] = await Promise.all([getCurrentUser(), getDisplaySettings()]);
  // Not a typedRoutes literal: the sign-in page is the catch-all
  // `/sign-in/[[...sign-in]]`, and `/sign-in` itself isn't in that route's
  // generated type even though Clerk resolves it correctly at runtime.
  if (user === null) redirect('/sign-in' as Route);

  return (
    <SidebarProvider style={{ '--sidebar-width': '17rem' } as CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        {/* One row, not two. The wordmark used to sit here above each page's
            own `<h1>`; the redesign gives the bar a single identity block —
            portfolio name over screen name — and leaves "Finansify" to the
            sidebar/drawer, which is the only place it appears now. */}
        <header className="flex h-14 items-center gap-2 px-4">
          {/* Opens the same `Sidebar` the desktop rail renders — shadcn's
              primitive already swaps it for a `Sheet` under `md`, so this is
              the phone's path to Portfolio/Transactions/More rather than a
              second, parallel nav surface. */}
          <SidebarTrigger />
          <HeaderTitle />
          {/* Theme, language, currency — in that order, weight increasing to
              the right: two ghost icons and then the presentation currency as
              a filled pill, because it is the one control here that changes
              every number on the page. */}
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <LocaleSwitcher />
            <CurrencySwitcher settings={display} />
          </div>
          <UserMenu user={user} />
        </header>
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">{children}</main>
      </SidebarInset>
      <BottomNav />
    </SidebarProvider>
  );
}
