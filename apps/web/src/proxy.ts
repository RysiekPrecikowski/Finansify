import { clerkMiddleware } from '@clerk/nextjs/server';

/**
 * Runs Clerk's session handling on every request so Server Components always see
 * a valid session. Named `proxy`, not `middleware` -- this Next.js version renamed
 * the convention. See apps/web/AGENTS.md.
 */
export const proxy = clerkMiddleware();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
