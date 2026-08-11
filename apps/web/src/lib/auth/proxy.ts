import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Sign-in/up are the two routes ADR 0009 (rule 4) names as the exception where
// Clerk's own components appear; everything else requires a session.
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

/**
 * The request gate, kept here rather than in `src/proxy.ts` so that
 * `@clerk/nextjs` stays confined to this directory (ADR 0009, rule 2).
 * `src/proxy.ts` is a framework shim that delegates to this.
 */
export const authProxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});
