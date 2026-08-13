'use client';

import { wrappers } from '@finansify/core/vocabulary';
import Link from 'next/link';
import { useActionState, type ReactNode } from 'react';

import { createAccountAction } from '@/app/(app)/accounts/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { idleFormState } from '@/lib/form-state';
import { useI18n } from '@/lib/i18n/client';

/**
 * What an account's cash balance may be denominated in. Deliberately a short
 * closed list rather than every ISO 4217 code: these are the currencies a Polish
 * investor's broker actually settles in, and the schema still checks the shape
 * of whatever arrives. Grow it when a real account needs one that is missing.
 */
const currencies = ['PLN', 'USD', 'EUR', 'GBP', 'CHF'] as const;

function errorId(field: string): string {
  return `${field}-error`;
}

/**
 * One field's label, control and errors. The wiring — `htmlFor`, `aria-invalid`,
 * `aria-describedby` — is the whole reason this exists: done per-field by hand it
 * is done inconsistently, and a validation message no screen reader announces is
 * not a validation message.
 */
function Field({
  name,
  label,
  errors,
  children,
}: Readonly<{
  name: string;
  label: string;
  errors: readonly string[] | undefined;
  children: ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {errors !== undefined &&
        errors.map((message) => (
          <p key={message} id={errorId(name)} role="alert" className="text-destructive text-xs">
            {message}
          </p>
        ))}
    </div>
  );
}

export function AccountForm({ today }: Readonly<{ today: string }>) {
  const { dictionary } = useI18n();
  const strings = dictionary.accounts;
  const [state, formAction, isPending] = useActionState(createAccountAction, idleFormState);

  // `undefined` rather than `false`: React drops the attribute entirely, so a
  // valid field carries no `aria-invalid="false"` noise.
  const invalid = (field: string) => (state.fieldErrors[field] === undefined ? undefined : true);
  const describedBy = (field: string) =>
    state.fieldErrors[field] === undefined ? undefined : errorId(field);

  const wrapperItems = wrappers.map((wrapper) => ({
    value: wrapper,
    label: dictionary.wrappers[wrapper],
  }));
  const currencyItems = currencies.map((code) => ({ value: code, label: code }));

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-5">
      <Field name="name" label={strings.name} errors={state.fieldErrors.name}>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="off"
          aria-invalid={invalid('name')}
          aria-describedby={describedBy('name')}
        />
      </Field>

      <Field name="broker" label={strings.broker} errors={state.fieldErrors.broker}>
        <Input
          id="broker"
          name="broker"
          type="text"
          autoComplete="off"
          aria-invalid={invalid('broker')}
          aria-describedby={describedBy('broker')}
        />
      </Field>

      <Field name="wrapper" label={strings.wrapper} errors={state.fieldErrors.wrapper}>
        <Select name="wrapper" defaultValue={wrappers[0]} items={wrapperItems}>
          <SelectTrigger
            id="wrapper"
            className="w-full"
            aria-invalid={invalid('wrapper')}
            aria-describedby={describedBy('wrapper')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {wrapperItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field name="currency" label={strings.currency} errors={state.fieldErrors.currency}>
        <Select name="currency" defaultValue={currencies[0]} items={currencyItems}>
          <SelectTrigger
            id="currency"
            className="w-full"
            aria-invalid={invalid('currency')}
            aria-describedby={describedBy('currency')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencyItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field name="openedAt" label={strings.openedAt} errors={state.fieldErrors.openedAt}>
        {/* `type="date"` submits YYYY-MM-DD, which is exactly what
            `accountInputSchema` hands to `Temporal.PlainDate.from`. */}
        <Input
          id="openedAt"
          name="openedAt"
          type="date"
          defaultValue={today}
          aria-invalid={invalid('openedAt')}
          aria-describedby={describedBy('openedAt')}
        />
      </Field>

      {state.formError !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.saving : strings.save}
        </Button>
        {/* `nativeButton={false}` because this renders an `<a>`, not a `<button>`. */}
        <Button variant="ghost" nativeButton={false} render={<Link href="/accounts" />}>
          {strings.cancel}
        </Button>
      </div>
    </form>
  );
}
