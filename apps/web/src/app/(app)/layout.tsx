import type { Route } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/app-sidebar';
import { BottomNav } from '@/components/bottom-nav';
import { CurrencySwitcher } from '@/components/currency-switcher';
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
        <header className="flex h-14 items-center gap-2 px-4">
          {/* Opens the same `Sidebar` the desktop rail renders — shadcn's
              primitive already swaps it for a `Sheet` under `md`, so this is
              the phone's path to Portfolio/Transactions/More rather than a
              second, parallel nav surface. */}
          <SidebarTrigger />
          <span className="font-semibold tracking-tight md:hidden">Finansify</span>
          {/* Currency, language and theme are one control cluster at every
              width, grouped into a single pill so the header reads as one
              control rather than three buttons in a row. */}
          <div className="bg-surface-3 ml-auto flex items-center gap-0.5 rounded-full p-0.5">
            <CurrencySwitcher settings={display} />
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
          <UserMenu user={user} />
        </header>
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">{children}</main>
      </SidebarInset>
      <BottomNav />
    </SidebarProvider>
  );
}
