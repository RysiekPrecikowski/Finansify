import { type ZodError } from 'zod';

/**
 * One correctable problem with a submitted value, addressed to the field that
 * carries it.
 */
export interface FieldIssue {
  /** Dotted path into the submitted object, e.g. `fxRate`. Empty for form-level. */
  readonly path: string;
  readonly message: string;
}

/**
 * Use cases **return** validation failures rather than throwing them: a form has
 * to render them field by field, and an exception cannot carry that shape
 * without the caller unwrapping it again at the UI edge.
 *
 * Only *user-correctable* problems become issues. A database that is down, or a
 * repository refusing an id that is not the caller's, still throws — neither is
 * something a user can fix by editing a field.
 */
export type UseCaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

/**
 * The zod → issues fold, once. Every use case needs the identical conversion,
 * and a third copy of it would be a refactor waiting to happen (rule 13).
 *
 * Deliberately not `error.flatten()`: the flattened shape collapses nested
 * paths, and the field path is exactly what the caller renders against.
 */
export function issuesOf(error: ZodError): readonly FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export function failure(issues: readonly FieldIssue[]): {
  ok: false;
  issues: readonly FieldIssue[];
} {
  return { ok: false, issues };
}

export function success<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}
