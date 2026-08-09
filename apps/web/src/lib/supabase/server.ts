import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for Server Components, Server Actions and route handlers.
 *
 * Auth only. Data access goes through Drizzle in @finansify/db -- one query path,
 * not two. See docs/architecture.md.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Returns the signed-in user, or null.
 *
 * Always use this rather than `getSession()` on the server: getUser() revalidates
 * the token with Supabase, while a session read trusts a cookie the client could forge.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
