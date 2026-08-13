import { type FieldIssue } from '@finansify/core';

/**
 * What every `useActionState` form in the app passes between the server action
 * and the client component that renders it.
 *
 * Deliberately shaped around `core`'s `FieldIssue` rather than zod's own error:
 * use cases return issues (`usecases/result.ts`) precisely so the UI can render
 * them field by field, and the only translation needed at this edge is from a
 * flat list into something a field can look itself up in.
 */
export interface FormState {
  readonly status: 'idle' | 'error';
  /** Keyed by field name, matching the `name` attributes of the inputs. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  /**
   * What was submitted, echoed back so a rejected form can re-render with the
   * user's own values still in it.
   *
   * React resets an uncontrolled input when the action re-renders the form, so
   * without this a single validation error empties every other field — fill in
   * a transaction, mistype the rate, and lose the lot. The form reads these in
   * preference to its initial values.
   */
  readonly values: Readonly<Record<string, string>>;
  /** For a failure that belongs to no single field. */
  readonly formError?: string;
}

export const idleFormState: FormState = { status: 'idle', fieldErrors: {}, values: {} };

/**
 * The submitted values, as strings, for echoing back on a rejected submit.
 *
 * `File` entries are dropped rather than coerced: they are not something a text
 * input can be re-populated from, and `String(file)` would put "[object File]"
 * in the box. Nothing on these forms is a secret — if a password ever reaches
 * one, it must be excluded here before this is reused.
 */
export function submittedValues(formData: FormData): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};

  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') values[name] = value;
  }

  return values;
}

/**
 * Folds `FieldIssue[]` into the record a form renders against.
 *
 * Several issues can land on one field — zod reports each failed check — so
 * messages accumulate rather than the last one winning. An issue with an empty
 * path is form-level and has no field to attach to; it is dropped here and
 * belongs in `formError` instead.
 */
export function byField(
  issues: readonly FieldIssue[],
): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};

  for (const issue of issues) {
    if (issue.path === '') continue;
    (errors[issue.path] ??= []).push(issue.message);
  }

  return errors;
}
