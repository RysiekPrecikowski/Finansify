import { makeSelectBond, makeSelectInstrument, type FieldIssue } from '@finansify/core';

import {
  getBondTermsResolver,
  getInstrumentSearchProvider,
  getInstruments,
  getSymbols,
} from '@/server/container';

/**
 * Resolving a picked instrument is two ports and no domain rule — instruments
 * are global (ADR 0010) and the ledger is user-scoped, so no single use case
 * owns both. Shared between the transaction form and the import
 * instrument-resolution screen (rule 13): both submit the same
 * `instrumentSelectionKind` plus either `instrumentId` or the `instrument*`
 * candidate fields that `<InstrumentCombobox>` writes, and both need the same
 * `findOrCreate` + symbol-save round trip before anything downstream can
 * point at the result.
 *
 * A bond never reaches `selectInstrument`: nothing quotes it, so there is no
 * listing to confirm. `selectBond` gates it by resolving the issue's terms
 * against the holder's own settlement date instead (ADR 0011), which is why
 * the trade date has to travel with the selection. The import screen never
 * submits this kind — every group it renders a combobox for came from a
 * parsed row, and nothing there looks like a bond series code.
 */
export async function resolveInstrumentSelection(
  formData: FormData,
): Promise<{ ok: true; id: string | null } | { ok: false; issues: readonly FieldIssue[] }> {
  const kind = formData.get('instrumentSelectionKind');
  if (kind !== 'existing' && kind !== 'candidate' && kind !== 'bond') {
    // Nothing was picked — correct for a transaction type that has no
    // instrument leg at all.
    return { ok: true, id: null };
  }

  const text = (name: string): string | null => {
    const raw = formData.get(name);
    return typeof raw === 'string' && raw !== '' ? raw : null;
  };

  if (kind === 'bond') {
    const selectBond = makeSelectBond({
      instruments: getInstruments(),
      resolver: getBondTermsResolver(),
    });
    const resolved = await selectBond({
      seriesCode: text('instrumentSeriesCode'),
      settledOn: text('settleDate') ?? text('tradeDate'),
    });
    if (!resolved.ok) {
      return {
        ok: false,
        issues: resolved.issues.map((issue) => ({
          ...issue,
          path: issue.path === 'seriesCode' ? 'instrumentSeriesCode' : issue.path,
        })),
      };
    }
    return { ok: true, id: resolved.value.id };
  }

  const input =
    kind === 'existing'
      ? { kind, instrumentId: text('instrumentId') }
      : {
          kind,
          provider: text('instrumentProvider'),
          symbol: text('instrumentSymbol'),
          name: text('instrumentName'),
        };

  const selectInstrument = makeSelectInstrument({
    instruments: getInstruments(),
    symbols: getSymbols(),
    provider: getInstrumentSearchProvider(),
  });

  const resolved = await selectInstrument(input);
  if (!resolved.ok) return { ok: false, issues: onInstrumentFields(kind, resolved.issues) };

  return { ok: true, id: resolved.value.id };
}

/**
 * `selectInstrument`'s `candidate` branch reports issues on `symbol`, `name`,
 * `instrumentKind`, `isin` and `exchange` — callers name their form inputs
 * `instrumentSymbol` and friends so they cannot collide with a form's other
 * fields (a transaction's own `currency`, an import group's `batchId`).
 * Re-pointing the paths here is what makes a message land under the field
 * that caused it. The `existing` branch's one field is already named
 * `instrumentId` on both sides, so it passes through.
 */
export function onInstrumentFields(
  kind: 'existing' | 'candidate',
  issues: readonly FieldIssue[],
): readonly FieldIssue[] {
  if (kind === 'existing') return issues;
  return issues.map((issue) => ({
    ...issue,
    path: `instrument${issue.path.charAt(0).toUpperCase()}${issue.path.slice(1)}`,
  }));
}
