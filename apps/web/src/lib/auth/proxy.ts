import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Sign-in/up are the two routes ADR 0009 (rule 4) names as the exception where
// Clerk's own components appear; everything else requires a session.
//
// /api/dev/test-login is public too, on dev/preview only: it has to be
// reachable *before* a session exists, since its whole job is to create one
// for the shared test user (docs/deployment.md, "Test user"). The route
// handler itself refuses on VERCEL_ENV === 'production', so this only widens
// the public surface where that guard already applies.
const publicRoutes =
  process.env.VERCEL_ENV === 'production'
    ? ['/sign-in(.*)', '/sign-up(.*)']
    : ['/sign-in(.*)', '/sign-up(.*)', '/api/dev/test-login'];
const isPublicRoute = createRouteMatcher(publicRoutes);

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
