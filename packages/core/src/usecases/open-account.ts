import { currency } from '../money';
import { accountInputSchema, type Account } from '../ledger/types';
import { type ScopedLedgerRepository } from '../ledger/ports';
import { Temporal } from '../time';
import { failure, issuesOf, success, type UseCaseResult } from './result';

/**
 * Opening an account is one write, but it is not a pass-through:
 * `accountInputSchema` produces plain strings and `AccountInput` wants a branded
 * `Currency` and a `PlainDate`. That conversion has to happen somewhere, and
 * `apps/web` is the wrong somewhere — a route that builds domain values itself
 * is a route that will eventually build one wrongly.
 *
 * The repository is already scoped to a user, so there is no id to pass and no
 * ownership to check here (rule 4, ADR 0009).
 */
export function makeOpenAccount(deps: { ledger: ScopedLedgerRepository }) {
  return async function openAccount(input: unknown): Promise<UseCaseResult<Account>> {
    const parsed = accountInputSchema.safeParse(input);
    if (!parsed.success) return failure(issuesOf(parsed.error));

    // Both conversions are total by this point: the schema has already checked
    // the currency against `/^[A-Z]{3}$/` and the date against Temporal itself,
    // so neither `currency()` nor `from()` can throw here.
    return success(
      await deps.ledger.createAccount({
        name: parsed.data.name,
        broker: parsed.data.broker,
        wrapper: parsed.data.wrapper,
        currency: currency(parsed.data.currency),
        openedAt: Temporal.PlainDate.from(parsed.data.openedAt),
      }),
    );
  };
}
