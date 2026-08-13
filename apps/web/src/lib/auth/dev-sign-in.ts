import { clerkClient } from '@clerk/nextjs/server';

/**
 * Mints a Clerk Agent Task for the shared `TEST_USER_EMAIL` account — Clerk's
 * own mechanism for "agent-driven flows where full authentication isn't
 * practical." Visiting the returned URL creates a session and redirects,
 * with no client-side sign-in step at all. See "Test user" in
 * docs/deployment.md.
 *
 * Dev/preview only: refuses on production, and when `TEST_USER_EMAIL` is
 * unset (nothing to sign in as).
 */
export async function createDevSignInUrl(redirectUrl: string): Promise<string> {
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('Dev sign-in is not available in production');
  }

  const email = process.env.TEST_USER_EMAIL;
  if (email === undefined || email === '') {
    throw new Error('TEST_USER_EMAIL is not set');
  }

  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ emailAddress: [email] });
  const user = users[0];
  if (user === undefined) {
    throw new Error(`No Clerk user found for TEST_USER_EMAIL "${email}"`);
  }

  const agentTask = await client.agentTasks.create({
    onBehalfOf: { userId: user.id },
    permissions: '*',
    agentName: 'finansify-dev-login',
    taskDescription: 'Local/preview sign-in as the shared test user',
    redirectUrl,
    sessionMaxDurationInSeconds: 60 * 60, // 1 hour — plenty for a testing session
  });
  return agentTask.url;
}
