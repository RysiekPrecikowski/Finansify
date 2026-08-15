import { z } from 'zod';

import { type BondTermsResolver } from '../bonds/ports';
import { parseSeriesCode } from '../bonds/series-code';
import { type BondSeriesCode } from '../bonds/types';
import { type InstrumentRepository } from '../ledger/ports';
import { type Instrument } from '../ledger/types';
import { currency as toCurrency } from '../money';
import { Temporal } from '../time';
import { failure, issuesOf, success, type UseCaseResult } from './result';

/**
 * Picking a Polish retail bond, which cannot go through `selectInstrument`.
 *
 * That use case exists to stop an unresolvable instrument being persisted, and
 * it does that by confirming the symbol against a live quote (ADR 0014). No
 * provider quotes these bonds — that is the entire premise of ADR 0011 — so
 * the equivalent gate here is different in mechanism and identical in purpose:
 * **the series code must parse into a family we hold rules for, and its terms
 * must resolve**. A series we cannot resolve is a validation failure, not a
 * saved-but-unvaluable row.
 *
 * There is no `exchange` and no provider symbol mapping, because there is no
 * provider. The series code *is* the identity, and it is globally unique by
 * construction — `EDO0836` means the same issue for everyone.
 */
export const bondSelectionSchema = z.object({
  seriesCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}\d{4}$/, 'A series code looks like EDO0836'),
  /** The holder's own settlement date — it decides which family rules apply. */
  settledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date'),
});

/** Every retail series is PLN, 100 zł nominal, and quoted nowhere. */
const PLN = toCurrency('PLN');

export function makeSelectBond(deps: {
  instruments: InstrumentRepository;
  resolver: BondTermsResolver;
}) {
  return async function selectBond(input: unknown): Promise<UseCaseResult<Instrument>> {
    const parsed = bondSelectionSchema.safeParse(input);
    if (!parsed.success) return failure(issuesOf(parsed.error));

    let code: BondSeriesCode;
    try {
      code = parseSeriesCode(parsed.data.seriesCode).code;
    } catch {
      return failure([{ path: 'seriesCode', message: 'Not a series Finansify has rules for' }]);
    }

    let settledOn: Temporal.PlainDate;
    try {
      settledOn = Temporal.PlainDate.from(parsed.data.settledOn);
    } catch {
      return failure([{ path: 'settledOn', message: 'Expected a date' }]);
    }

    // The gate. Resolving also caches the issue's parameters for every other
    // holder of the series (ADR 0011), so the first person to add it pays the
    // fetch and nobody else does.
    const terms = await deps.resolver.resolve(code, settledOn);
    if (terms === null) {
      return failure([
        {
          path: 'seriesCode',
          message: 'Could not find the terms for this issue — it may need entering by hand',
        },
      ]);
    }

    const instrument = await deps.instruments.findOrCreate({
      symbol: code,
      // A name a human recognizes on a statement, built from what the code
      // already means rather than fetched from anywhere.
      name: `Obligacja skarbowa ${code}`,
      kind: 'bond',
      currency: PLN,
      isin: null,
      // Deliberately null: these are not listed anywhere, and `instruments`
      // is unique on `(symbol, exchange)` with `NULLS NOT DISTINCT`, so the
      // series code alone keys the row.
      exchange: null,
    });

    return success(instrument);
  };
}

/**
 * Whether a typed query is shaped like a series code.
 *
 * Used by the instrument picker to decide whether to *offer* a bond alongside
 * the provider's search hits. Deliberately shape-only and deliberately not a
 * validation: it runs on every keystroke, and the real check — does this
 * family exist, do its terms resolve — belongs in `selectBond`, on the server,
 * where a rejection can say why.
 */
export function looksLikeSeriesCode(query: string): boolean {
  return /^[A-Za-z]{3}\d{4}$/.test(query.trim());
}
