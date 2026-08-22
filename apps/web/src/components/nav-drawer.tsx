'use client';

import type { AuthenticatedUser } from '@finansify/core';
import { LogOut, SlidersHorizontal, User, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useSidebar } from '@/components/ui/sidebar';
import { useDisplayIdentity, useSignOut } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/client';
import { drawerScreens } from '@/lib/nav-items';
import { cn } from '@/lib/utils';

/**
 * The phone navigation drawer — the content of the `Sheet` the shadcn
 * `Sidebar` primitive already swaps in under `md`, not a second nav surface.
 *
 * Richer than the desktop rail on purpose: a phone has no persistent sidebar,
 * so this is the only place the signed-in identity, the screens that do not
 * fit in the four-tab bottom bar, and sign-out are reachable at all. The
 * desktop rail stays the plain icon+label list it is — sharing one component
 * across both would mean an identity card and a sign-out row inside a 3 rem
 * collapsed rail.
 */

/** ~52 px, matching the canvas: a comfortable touch target without being a button-sized block. */
const rowClassName =
  'flex h-[52px] items-center gap-3 rounded-xl px-3 text-[0.9375rem] transition-colors [&_svg]:size-5 [&_svg]:shrink-0';

function ScreenRow({
  href,
  icon: Icon,
  label,
  active,
  comingSoonLabel,
  onNavigate,
  muted = false,
}: Readonly<{
  href: string | null;
  icon: typeof User;
  label: string;
  active?: boolean;
  comingSoonLabel?: string;
  onNavigate?: () => void;
  /** The below-the-divider rows sit a step back from the primary screen list. */
  muted?: boolean;
}>) {
  const body = (
    <>
      <Icon aria-hidden />
      <span className={cn('truncate', active === true && 'font-semibold')}>{label}</span>
      {comingSoonLabel !== undefined && (
        <Badge variant="outline" className="text-muted-foreground ml-auto">
          {comingSoonLabel}
        </Badge>
      )}
    </>
  );

  // No `href` means the screen does not exist yet. Rendered as an inert row
  // rather than a disabled link: there is nothing to navigate to, so there
  // should be nothing focusable either (same treatment as an unsupported
  // chart range in `components/dashboard/range-tabs.tsx`).
  if (href === null) {
    return (
      <span
        aria-disabled="true"
        className={cn(rowClassName, 'text-muted-foreground/60 select-none')}
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      href={href as never}
      onClick={onNavigate}
      aria-current={active === true ? 'page' : undefined}
      className={cn(
        rowClassName,
        active === true
          ? 'bg-muted text-foreground'
          : muted
            ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            : 'text-foreground hover:bg-muted/50',
      )}
    >
      {body}
    </Link>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
}: Readonly<{ icon: typeof User; label: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        rowClassName,
        'text-muted-foreground hover:text-foreground hover:bg-muted/50 w-full text-left',
      )}
    >
      <Icon aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function NavDrawer({ user }: Readonly<{ user: AuthenticatedUser }>) {
  const pathname = usePathname();
  const { dictionary } = useI18n();
  const { setOpenMobile } = useSidebar();
  const signOut = useSignOut();
  const identity = useDisplayIdentity(user.email);

  const strings = dictionary.drawer;
  const close = () => setOpenMobile(false);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 pt-4 pb-6">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold tracking-tight">{dictionary.app.name}</span>
        <button
          type="button"
          onClick={close}
          aria-label={strings.close}
          className="bg-muted text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Identity. The email is the fact the domain owns and arrives from the
          server; the name and avatar are Clerk decoration added on the client
          (`lib/auth/client.ts`), so this renders the email alone for the one
          frame before Clerk resolves rather than flashing a placeholder. */}
      <div className="bg-muted flex items-center gap-3 rounded-2xl px-4 py-3.5">
        <Avatar size="lg">
          {identity !== null && identity.imageUrl !== null && (
            <AvatarImage src={identity.imageUrl} alt="" />
          )}
          <AvatarFallback>
            <User className="size-5" aria-hidden />
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          {identity !== null && (
            <span className="truncate text-sm font-semibold">{identity.name}</span>
          )}
          <span className="text-muted-foreground truncate text-xs">{user.email}</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label={strings.sectionScreens}>
        <span className="text-muted-foreground/70 px-3 pt-2 pb-1 text-[0.6875rem] font-medium tracking-wider uppercase">
          {strings.sectionScreens}
        </span>

        {drawerScreens.map((screen) => (
          <ScreenRow
            key={screen.labelKey}
            href={screen.href}
            icon={screen.icon}
            label={strings.screens[screen.labelKey]}
            active={screen.href !== null && pathname.startsWith(screen.href)}
            comingSoonLabel={screen.href === null ? strings.comingSoon : undefined}
            onNavigate={close}
          />
        ))}

        <hr className="border-border my-2" />

        {/* `/more` covers more than settings, so the shared `nav-items.ts`
            label stays "Więcej" for the bottom bar; only this row renames it. */}
        <ScreenRow
          href="/more"
          icon={SlidersHorizontal}
          label={strings.settings}
          active={pathname.startsWith('/more')}
          onNavigate={close}
          muted
        />
        <ActionRow icon={LogOut} label={dictionary.actions.signOut} onClick={signOut} />
      </nav>
    </div>
  );
}
