'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { navItems } from '@/lib/nav-items';
import { useI18n } from '@/lib/i18n/client';

export function AppSidebar() {
  const pathname = usePathname();
  const { dictionary } = useI18n();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center">
        <span className="px-2 text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
          Finansify
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname.startsWith(item.href)}
                    tooltip={dictionary.nav[item.labelKey]}
                    // Desktop-only navigation, so the target can afford to be
                    // bigger than the 8px-grid default the primitive ships with.
                    className="h-10 gap-3 px-3 text-[0.9375rem] [&_svg]:size-5"
                  >
                    <item.icon />
                    <span>{dictionary.nav[item.labelKey]}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
