import { ArrowLeftRight, LayoutDashboard, MoreHorizontal, Wallet } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { type Route } from 'next';

import { type Dictionary } from '@/lib/i18n/dictionaries';

export interface NavItem {
  href: Route;
  /** Resolved through the dictionary at render time, not stored as a string. */
  labelKey: keyof Dictionary['nav'];
  icon: LucideIcon;
}

// Same routes for the desktop sidebar and the mobile bottom tab bar — see docs/ui.md.
export const navItems: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/portfolio', labelKey: 'portfolio', icon: Wallet },
  { href: '/transactions', labelKey: 'transactions', icon: ArrowLeftRight },
  { href: '/more', labelKey: 'more', icon: MoreHorizontal },
];
