import { ChevronRight, Download, Landmark } from 'lucide-react';
import Link from 'next/link';

import { getDictionary } from '@/lib/i18n/server';

/**
 * `/accounts` is reached from here rather than from the nav: the bottom bar and
 * the sidebar stay at four entries (docs/ui.md), and this is the overflow those
 * four leave room for.
 */
export default async function MorePage() {
  const dictionary = await getDictionary();

  return (
    <div className="flex h-full flex-col items-stretch gap-4">
      <h1 className="text-lg font-semibold">{dictionary.nav.more}</h1>

      <nav className="divide-border max-w-md divide-y border-y">
        <Link
          href="/accounts"
          className="hover:bg-muted/50 flex items-center gap-3 px-1 py-3 text-sm"
        >
          <Landmark className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="flex-1">{dictionary.accounts.title}</span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Link>
        <Link
          href="/export"
          className="hover:bg-muted/50 flex items-center gap-3 px-1 py-3 text-sm"
        >
          <Download className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="flex-1">{dictionary.export.title}</span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Link>
      </nav>

      <p className="text-muted-foreground text-sm">{dictionary.placeholder.more}</p>
    </div>
  );
}
