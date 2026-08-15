import { Temporal, type IndexObservation, type IndexObservationProvider } from '@finansify/core';
import Decimal from 'decimal.js';

/**
 * The NBP reference rate, which ROR and DOR reset against.
 *
 * **Not** on `api.nbp.pl` — that serves exchange-rate tables and gold and
 * nothing else. These two static files are what nbp.pl's own rates page reads
 * (ADR 0015). Together they give the complete history back to 1998-02-26 in two
 * GETs, which is the whole series: the rate changes a handful of times a year.
 */
const CURRENT_URL = 'https://static.nbp.pl/dane/stopy/stopy_procentowe.xml';
const ARCHIVE_URL = 'https://static.nbp.pl/dane/stopy/stopy_procentowe_archiwum.xml';

/**
 * Parsed with regular expressions rather than an XML library, for the same
 * reason `fx-provider.ts` hand-rolls its request: two fixed files with a flat,
 * attribute-only shape and no namespaces on the elements we read. A parser
 * dependency would buy nothing and still need the validation below.
 *
 * The two files disagree about where the date lives, which is the only real
 * complexity here:
 *
 *   current:  <pozycja id="ref" oprocentowanie="3,75" obowiazuje_od="2026-03-05" />
 *   archive:  <pozycje obowiazuje_od="1998-02-26"> <pozycja id="ref" oprocentowanie="24,00" /> ...
 */
const ARCHIVE_GROUP = /<pozycje\b[^>]*?obowiazuje_od="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/pozycje>/gs;
const REF_IN_GROUP = /<pozycja\b[^>]*?id="ref"[^>]*?oprocentowanie="([^"]*)"[^>]*?\/>/s;
const CURRENT_REF =
  /<pozycja\b(?=[^>]*?id="ref")(?=[^>]*?oprocentowanie="([^"]*)")(?=[^>]*?obowiazuje_od="(\d{4}-\d{2}-\d{2})")[^>]*?\/>/gs;

/**
 * The reference rate has never been above 25% (1998's peak was 24%) nor
 * negative. A value outside that band means the file changed shape or the
 * regex matched something else — refuse it rather than write a number that
 * silently re-rates every ROR and DOR holding. `docs/data-sources.md`: fail
 * loudly rather than be clever.
 */
const MAX_PLAUSIBLE_RATE = new Decimal('0.30');

export class ImplausibleRateError extends Error {
  constructor(value: string, on: string) {
    super(
      `NBP reference rate "${value}" effective ${on} is outside the plausible band (0–30%) — refusing to write it`,
    );
    this.name = 'ImplausibleRateError';
  }
}

/**
 * `"3,75"` → `0.0375`. Comma decimal separator, percent to fraction.
 *
 * The attribute is captured as `[^"]*` rather than a digit class on purpose: a
 * negative or non-numeric value has to reach this function to be *refused*. A
 * tighter capture would make the regex simply not match, and the entry would be
 * skipped in silence — which is the failure mode `docs/data-sources.md` calls
 * out as worse than an outage.
 */
function toFraction(raw: string, on: string): Decimal {
  // `Decimal` parses the string directly — no `parseFloat` at any point (rule 1)
  // — and throws its own error on junk, which becomes our error so callers have
  // one type to catch and the message names the offending value.
  let percent: Decimal;
  try {
    percent = new Decimal(raw.replace(',', '.'));
  } catch {
    throw new ImplausibleRateError(raw, on);
  }
  if (!percent.isFinite()) throw new ImplausibleRateError(raw, on);

  const fraction = percent.dividedBy(100);
  if (fraction.isNegative() || fraction.greaterThan(MAX_PLAUSIBLE_RATE)) {
    throw new ImplausibleRateError(raw, on);
  }
  return fraction;
}

export function parseCurrentReferenceRate(xml: string): readonly IndexObservation[] {
  const found: IndexObservation[] = [];
  for (const match of xml.matchAll(CURRENT_REF)) {
    const [, rate, on] = match;
    if (rate === undefined || on === undefined) continue;
    found.push({
      indexId: 'nbp_reference',
      effectiveFrom: Temporal.PlainDate.from(on),
      value: toFraction(rate, on),
    });
  }
  return found;
}

export function parseArchiveReferenceRates(xml: string): readonly IndexObservation[] {
  const found: IndexObservation[] = [];
  for (const group of xml.matchAll(ARCHIVE_GROUP)) {
    const [, on, body] = group;
    if (on === undefined || body === undefined) continue;
    // Not every archived block carries a reference rate — the earliest ones
    // predate it and list only lombard and rediscount. Skipping is correct;
    // inventing one is not.
    const ref = REF_IN_GROUP.exec(body);
    if (ref?.[1] === undefined) continue;
    found.push({
      indexId: 'nbp_reference',
      effectiveFrom: Temporal.PlainDate.from(on),
      value: toFraction(ref[1], on),
    });
  }
  return found;
}

/**
 * Newest-last, deduplicated by effective date. The archive's final entry and
 * the current file's entry describe the same change, so the current file wins:
 * it is the one that gets updated first after an RPP decision.
 */
export function mergeReferenceRates(
  archive: readonly IndexObservation[],
  current: readonly IndexObservation[],
): readonly IndexObservation[] {
  const byDate = new Map<string, IndexObservation>();
  for (const observation of [...archive, ...current]) {
    byDate.set(observation.effectiveFrom.toString(), observation);
  }
  return [...byDate.values()].sort((a, b) =>
    Temporal.PlainDate.compare(a.effectiveFrom, b.effectiveFrom),
  );
}

export const nbpReferenceRateProvider: IndexObservationProvider = {
  name: 'nbp',
  indexId: 'nbp_reference',

  async fetchObservations(): Promise<readonly IndexObservation[]> {
    const [archive, current] = await Promise.all([fetchXml(ARCHIVE_URL), fetchXml(CURRENT_URL)]);
    const merged = mergeReferenceRates(
      parseArchiveReferenceRates(archive),
      parseCurrentReferenceRate(current),
    );
    if (merged.length === 0) {
      throw new Error(`NBP returned no reference rates — refusing to treat that as "no change"`);
    }
    return merged;
  },
};

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NBP responded with ${response.status} for ${url}`);
  return response.text();
}
