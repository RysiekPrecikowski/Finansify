import { Show, UserButton } from '@clerk/nextjs';
import Link from 'next/link';

/**
 * `SignedIn`/`SignedOut` don't exist in this Clerk version -- replaced by the
 * server-only `<Show when="signed-in">`. See apps/web/AGENTS.md: this Next/Clerk
 * stack diverges from training data.
 */
export async function SiteHeader() {
  return (
    <Show when="signed-in">
      <header className="border-border flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Finansify
          </Link>
          <Link href="/portfolios" className="text-muted-foreground hover:text-foreground text-sm">
            Portfolios
          </Link>
          <Link href="/accounts" className="text-muted-foreground hover:text-foreground text-sm">
            Accounts
          </Link>
        </nav>
        <UserButton />
      </header>
    </Show>
  );
}
