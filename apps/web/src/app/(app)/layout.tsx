import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { BottomNav } from '@/components/bottom-nav';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger className="hidden md:flex" />
          <span className="font-semibold tracking-tight md:hidden">Finansify</span>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle className="md:hidden" />
          </div>
        </header>
        <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">{children}</main>
      </SidebarInset>
      <BottomNav />
    </SidebarProvider>
  );
}
