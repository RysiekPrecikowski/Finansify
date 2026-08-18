'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { interpolate } from '@/lib/i18n/dictionaries';

/**
 * The only reason this is a client component rather than the plain `<Button
 * type="submit">` it replaces: `useFormStatus` only reports its parent
 * `<form>`'s pending state to a component rendered inside that form, so
 * reading it has to happen here rather than on the server-rendered page.
 * `acceptAllPendingAction` can take a few seconds for a large statement
 * (CU-869ejgjrt) — without this, that whole window looks like a dead click.
 */
export function AcceptAllButton({ count }: { readonly count: number }) {
  const { pending } = useFormStatus();
  const { dictionary } = useI18n();
  const strings = dictionary.imports.review;

  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? strings.acceptingAll : interpolate(strings.acceptAll, { count: String(count) })}
    </Button>
  );
}
