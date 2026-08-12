import type { NextFetchEvent, NextRequest } from 'next/server';

import { authProxy } from '@/lib/auth/proxy';

// Next 16 renamed `middleware.ts` to `proxy.ts` and parses this file statically:
// the handler must be a function *declared here* and `config` a literal object.
// Re-exporting either (`export { default, config } from ...`) fails the build.
//
// Delegating satisfies that without dragging `@clerk/nextjs` outside
// `src/lib/auth/` — the shim is Next-shaped, the auth logic stays behind the
// boundary ADR 0009 draws, and swapping the auth provider still touches one
// directory.
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return authProxy(request, event);
}

export const config = {
  // Clerk's documented matcher: an explicit, closed list of static-asset
  // extensions, not "anything with a dot" — the open-ended form skips the RSC
  // payload route (<path>.rsc, served in Vercel's minimal mode) along with any
  // future dotted route segment (a ticker like CDR.WA), silently exempting it
  // from auth.protect(). API routes are re-added unconditionally since they
  // don't otherwise match the first pattern.
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
