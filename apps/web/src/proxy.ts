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
  // Skip Next internals and static files; run on everything else. Routing
  // concern, not an auth one, which is why it belongs in this file.
  matcher: ['/((?!_next|.*\\..*).*)'],
};
