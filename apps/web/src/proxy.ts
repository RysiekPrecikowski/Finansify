import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

/**
 * Runs Clerk's session handling on every request so Server Components always see
 * a valid session. Named `proxy`, not `middleware` -- this Next.js version renamed
 * the convention. See apps/web/AGENTS.md.
 *
 * Every route except sign-in/sign-up requires a session; `auth.protect()` redirects
 * anonymous visitors to sign-in itself.
 */
export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
