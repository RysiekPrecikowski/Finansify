'use client';

import { LogOut } from 'lucide-react';
import type { AuthenticatedUser } from '@finansify/core';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n/client';
import { useSignOut } from './client';

/**
 * Our own trigger over Clerk's `signOut()`, not Clerk's `<UserButton>` — ADR
 * 0009 rule 4 keeps Clerk's own components confined to /sign-in and
 * /sign-up; the app header shows our `AuthenticatedUser`, not a Clerk profile
 * widget.
 */
export function UserMenu({ user }: { user: AuthenticatedUser }) {
  const signOut = useSignOut();
  const { dictionary } = useI18n();
  const initial = user.email.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={dictionary.actions.account}
            className="rounded-full"
          >
            <Avatar size="sm">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground truncate text-xs font-normal">
            {user.email}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut />
          {dictionary.actions.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
