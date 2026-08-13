import { NextResponse } from 'next/server';

import { createDevSignInUrl } from '@/lib/auth/dev-sign-in';

// Dev/preview convenience: redirects to a Clerk Agent Task URL that signs the
// browser in as the shared test user and lands it back on the app — no
// password ever typed into a field. See "Test user" in docs/deployment.md.
export async function GET(request: Request) {
  const signInUrl = await createDevSignInUrl(new URL('/', request.url).toString());
  return NextResponse.redirect(signInUrl);
}
