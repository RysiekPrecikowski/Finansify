import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { AllocationView } from '@/components/allocation/allocation-view';
import { getCurrentUser } from '@/lib/auth';
import { getDictionary, getLocale } from '@/lib/i18n/server';

/**
 * "Skład i rebalans" — allocation by six dimensions, concentration, a target
 * model with deviations, and the orders that would close them.
 *
 * The page itself is a thin server shell: it authenticates, resolves the
 * locale and the dictionary, and hands both to a client view. Everything it
 * renders is synthetic today (`lib/allocation/demo-allocation.ts`) because
 * `packages/core` has no `getAllocation`/`getRebalancePlan` yet — those are
 * test-first `core` work (rule 17), not something to reverse-engineer from a
 * screen. When they land, this shell is where they get called and the view's
 * props stop being fixtures; its shape does not change.
 *
 * Reached from the nav drawer only. The bottom bar and the desktop rail stay at
 * four items — a fifth tab would push the ones people use every day narrower
 * for a screen visited occasionally.
 */
export default async function AllocationPage() {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in' as Route);

  const [locale, dictionary] = await Promise.all([getLocale(), getDictionary()]);

  return <AllocationView locale={locale} dictionary={dictionary} />;
}
