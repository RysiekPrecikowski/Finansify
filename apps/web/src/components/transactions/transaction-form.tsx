'use client';

import { fxRateSources, transactionTypes, type TransactionType } from '@finansify/core/vocabulary';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorId, Field } from '@/components/form-field';
import {
  InstrumentCombobox,
  type InstrumentComboboxInitial,
} from '@/components/instruments/instrument-combobox';
import { idleFormState, type FormState } from '@/lib/form-state';
import { useI18n } from '@/lib/i18n/client';

/**
 * `split` is deliberately absent from the type list. `buildPositions` throws
 * `UnsupportedTransactionTypeError` on it by design — a split silently
 * mis-applied corrupts cost basis retroactively — so offering it here would let
 * a user write a row that breaks their own positions view. The type stays in the
 * schema so Phase 4 can import one; the form gets it back when the ratio
 * handling is actually written (`docs/roadmap.md`, Feature backlog).
 */
const offeredTypes = transactionTypes.filter((type) => type !== 'split');

/** The currencies a Polish broker's account or transaction can be denominated in. */
const currencies = ['PLN', 'USD', 'EUR', 'GBP', 'CHF'] as const;

export interface TransactionShapeOfType {
  readonly instrument: 'required' | 'none';
  readonly amount: 'units' | 'gross';
}

export interface TransactionFormAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
}

/**
 * Every value a string, because that is what an `<input>` produces and what
 * `transactionInputSchema` parses. Nothing here is a `number` — a `Money` or a
 * `Decimal` reaching a client component would drag `core` into the bundle and
 * invite `valueAsNumber` back in (rule 1, ADR 0005).
 */
export interface TransactionFormValues {
  readonly id?: string;
  readonly accountId: string;
  readonly type: TransactionType;
  /**
   * `null` for a new transaction or one with no instrument leg. Editing a
   * transaction that already has one carries its id and display label —
   * resolved server-side (`form-options.ts`) so the combobox opens already
   * showing what's selected, without ever loading every instrument in the
   * database to find it.
   */
  readonly instrument: { readonly id: string; readonly label: string } | null;
  readonly tradeDate: string;
  readonly settleDate: string;
  readonly quantity: string;
  readonly price: string;
  readonly grossAmount: string;
  readonly fee: string;
  readonly tax: string;
  readonly currency: string;
  readonly fxRate: string;
  readonly fxRateSource: string;
  readonly note: string;
}

export function TransactionForm({
  action,
  values,
  accounts,
  shapes,
  submitLabel,
}: Readonly<{
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  values: TransactionFormValues;
  accounts: readonly TransactionFormAccount[];
  /** Computed on the server from `transactionShapeOf`, so `core` stays server-side. */
  shapes: Readonly<Record<string, TransactionShapeOfType>>;
  submitLabel: string;
}>) {
  const { dictionary } = useI18n();
  const strings = dictionary.transactions;
  const [state, formAction, isPending] = useActionState(action, idleFormState);

  // React resets an uncontrolled input when the action re-renders the form, so
  // a rejected submit would otherwise clear all fourteen fields over one bad
  // rate. The action echoes the submission back; prefer it over the initial
  // value everywhere, including the selects' starting state.
  const submitted = (field: string, fallback = '') => state.values[field] ?? fallback;

  const [type, setType] = useState<TransactionType>(
    submitted('type', values.type) as TransactionType,
  );
  const [accountId, setAccountId] = useState(submitted('accountId', values.accountId));
  const [currency, setCurrency] = useState(submitted('currency', values.currency));

  // Conditional visibility is convenience only. The server re-validates every
  // submission through `transactionInputSchemaFor(account.currency)`, so what the
  // form chooses to show never decides what is allowed.
  const shape = shapes[type] ?? { instrument: 'none', amount: 'gross' };
  const accountCurrency = accounts.find((account) => account.id === accountId)?.currency;
  const needsRate = accountCurrency !== undefined && currency !== accountCurrency;

  const invalid = (field: string) => (state.fieldErrors[field] === undefined ? undefined : true);
  const describedBy = (field: string) =>
    state.fieldErrors[field] === undefined ? undefined : errorId(field);

  const typeItems = offeredTypes.map((value) => ({ value, label: strings.types[value] }));
  const accountItems = accounts.map((account) => ({
    value: account.id,
    label: `${account.name} · ${account.currency}`,
  }));
  const currencyItems = currencies.map((code) => ({ value: code, label: code }));
  const sourceItems = fxRateSources.map((source) => ({
    value: source,
    label: strings.fxRateSources[source],
  }));

  // Search results, from `<InstrumentCombobox>`, are the only source of
  // `instrumentId`/`instrument*` fields on submit — nothing here echoes a
  // rejected candidate's fields back into an initial selection, since the
  // combobox's own state (a client component, not remounted by the action)
  // already survives a failed submit on its own.
  const instrumentInitial: InstrumentComboboxInitial =
    values.instrument === null
      ? null
      : { kind: 'existing', instrumentId: values.instrument.id, label: values.instrument.label };

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-5">
      {values.id !== undefined && <input type="hidden" name="id" value={values.id} />}

      <Field name="type" label={strings.type} errors={state.fieldErrors.type}>
        <Select
          name="type"
          value={type}
          onValueChange={(value) => setType(value as TransactionType)}
          items={typeItems}
        >
          <SelectTrigger id="type" className="w-full" aria-invalid={invalid('type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field name="accountId" label={strings.account} errors={state.fieldErrors.accountId}>
        <Select
          name="accountId"
          value={accountId}
          onValueChange={(value) => {
            const next = value as string;
            setAccountId(next);
            // A transaction is usually in its account's own currency; picking the
            // account is the moment that guess is worth making. Changing it after
            // is what reveals the fx fields.
            const picked = accounts.find((account) => account.id === next);
            if (picked !== undefined) setCurrency(picked.currency);
          }}
          items={accountItems}
        >
          <SelectTrigger id="accountId" className="w-full" aria-invalid={invalid('accountId')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accountItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {shape.instrument === 'required' && (
        <InstrumentCombobox
          initial={instrumentInitial}
          errors={
            state.fieldErrors.instrumentId ??
            state.fieldErrors.instrumentSymbol ??
            state.fieldErrors.instrumentSearch
          }
        />
      )}

      {shape.amount === 'units' && (
        <>
          <Field name="quantity" label={strings.quantity} errors={state.fieldErrors.quantity}>
            {/* `type="text"` with `inputMode="decimal"`, never `type="number"`:
                a number input silently discards what the browser considers
                invalid and invites `valueAsNumber`. */}
            <Input
              id="quantity"
              name="quantity"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={submitted('quantity', values.quantity)}
              aria-invalid={invalid('quantity')}
              aria-describedby={describedBy('quantity')}
            />
          </Field>

          <Field name="price" label={strings.price} errors={state.fieldErrors.price}>
            <Input
              id="price"
              name="price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={submitted('price', values.price)}
              aria-invalid={invalid('price')}
              aria-describedby={describedBy('price')}
            />
          </Field>
        </>
      )}

      <Field
        name="grossAmount"
        label={strings.grossAmount}
        // Offered for a units row too: it is the broker's actual figure, and
        // `grossValueOf` prefers it over quantity × price precisely because the
        // two disagree by a grosz the moment a broker rounds.
        hint={shape.amount === 'units' ? strings.grossAmountHint : undefined}
        errors={state.fieldErrors.grossAmount}
      >
        <Input
          id="grossAmount"
          name="grossAmount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={submitted('grossAmount', values.grossAmount)}
          aria-invalid={invalid('grossAmount')}
          aria-describedby={describedBy('grossAmount')}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field name="fee" label={strings.fee} errors={state.fieldErrors.fee}>
          <Input
            id="fee"
            name="fee"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={submitted('fee', values.fee)}
            aria-invalid={invalid('fee')}
            aria-describedby={describedBy('fee')}
          />
        </Field>

        <Field name="tax" label={strings.tax} errors={state.fieldErrors.tax}>
          <Input
            id="tax"
            name="tax"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={submitted('tax', values.tax)}
            aria-invalid={invalid('tax')}
            aria-describedby={describedBy('tax')}
          />
        </Field>
      </div>

      <Field name="currency" label={strings.currency} errors={state.fieldErrors.currency}>
        <Select
          name="currency"
          value={currency}
          onValueChange={(value) => setCurrency(value as string)}
          items={currencyItems}
        >
          <SelectTrigger id="currency" className="w-full" aria-invalid={invalid('currency')}>
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

      {needsRate && (
        /* Rule 6 / ADR 0006. A broker converts at its own spread, so there is no
           defensible rate to default to and none is offered. The server refuses
           the row through `transactionInputSchemaFor`; this only explains why. */
        <fieldset className="border-border flex flex-col gap-5 rounded-md border p-4">
          {/* The pair is interpolated in JSX rather than through a dictionary
              function: dictionaries are plain objects, which is the only reason
              they can cross to a client component at all. */}
          <legend className="text-muted-foreground px-1 text-xs">
            {`${currency} → ${accountCurrency}`}: {strings.fxRequired}
          </legend>

          <Field name="fxRate" label={strings.fxRate} errors={state.fieldErrors.fxRate}>
            <Input
              id="fxRate"
              name="fxRate"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={submitted('fxRate', values.fxRate)}
              aria-invalid={invalid('fxRate')}
              aria-describedby={describedBy('fxRate')}
            />
          </Field>

          <Field
            name="fxRateSource"
            label={strings.fxRateSource}
            errors={state.fieldErrors.fxRateSource}
          >
            <Select
              name="fxRateSource"
              defaultValue={submitted('fxRateSource', values.fxRateSource)}
              items={sourceItems}
            >
              <SelectTrigger
                id="fxRateSource"
                className="w-full"
                aria-invalid={invalid('fxRateSource')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field name="tradeDate" label={strings.tradeDate} errors={state.fieldErrors.tradeDate}>
          <Input
            id="tradeDate"
            name="tradeDate"
            type="date"
            defaultValue={submitted('tradeDate', values.tradeDate)}
            aria-invalid={invalid('tradeDate')}
            aria-describedby={describedBy('tradeDate')}
          />
        </Field>

        <Field name="settleDate" label={strings.settleDate} errors={state.fieldErrors.settleDate}>
          <Input
            id="settleDate"
            name="settleDate"
            type="date"
            defaultValue={submitted('settleDate', values.settleDate)}
            aria-invalid={invalid('settleDate')}
            aria-describedby={describedBy('settleDate')}
          />
        </Field>
      </div>

      <Field name="note" label={strings.note} errors={state.fieldErrors.note}>
        <Textarea
          id="note"
          name="note"
          rows={3}
          maxLength={500}
          defaultValue={submitted('note', values.note)}
          aria-invalid={invalid('note')}
          aria-describedby={describedBy('note')}
        />
      </Field>

      {state.formError !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.saving : submitLabel}
        </Button>
        {/* `nativeButton={false}` because this renders an `<a>`, not a `<button>`. */}
        <Button variant="ghost" nativeButton={false} render={<Link href="/transactions" />}>
          {strings.cancel}
        </Button>
      </div>
    </form>
  );
}
