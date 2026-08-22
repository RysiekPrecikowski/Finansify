import {
  ArrowLeftRight,
  Banknote,
  LayoutDashboard,
  MoreHorizontal,
  PieChart,
  Wallet,
} from 'lucide-react';
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

export interface DrawerScreen {
  /**
   * `null` for a screen the app does not have yet. The drawer renders those as
   * inert rows carrying a "wkrótce" badge rather than as links — the same
   * stance `lib/dashboard-params.ts` takes for an unsupported chart range, and
   * for the same reason: the row exists so the shape of the menu does not
   * change when the screen lands, but there is nothing to navigate to and a
   * href would be a 404 waiting to be clicked.
   */
  href: Route | null;
  labelKey: keyof Dictionary['drawer']['screens'];
  /**
   * A shorter form of `labelKey`, shown in the header bar instead of it.
   * Optional — most screen names fit the bar as-is. `allocation` is the one
   * exception so far: "Skład i rebalans" needs 144px against the ~109px the
   * header's fixed chrome (trigger, the theme/language/currency pill, the
   * avatar) leaves at 390px, and neither shrinking that chrome further nor
   * dropping the avatar is the fix — the drawer keeps the full descriptive
   * name, the bar gets the shorter one the page's own "Rebalans" heading
   * already uses.
   */
  headerLabelKey?: keyof Dictionary['drawer']['screens'];
  icon: LucideIcon;
}

/**
 * The drawer's "Ekrany" section. Deliberately **not** `navItems`: that list is
 * the three-or-four-tab surface the bottom bar and the desktop rail share, and
 * it carries `/more`, which the drawer shows separately as "Ustawienia" below
 * the divider. Two entries here have no route at all yet.
 */
export const drawerScreens: DrawerScreen[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/portfolio', labelKey: 'portfolio', icon: Wallet },
  { href: '/transactions', labelKey: 'transactions', icon: ArrowLeftRight },
  {
    href: '/allocation',
    labelKey: 'allocation',
    headerLabelKey: 'allocationShort',
    icon: PieChart,
  },
  { href: null, labelKey: 'cash', icon: Banknote },
];
