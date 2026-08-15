import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ImplausibleRateError,
  mergeReferenceRates,
  parseArchiveReferenceRates,
  parseCurrentReferenceRate,
} from './reference-rate-provider';

/**
 * Fixtures are the real files, saved on 2026-08-14 — the current one whole, the
 * archive trimmed to six of its ninety-six blocks. No network in tests.
 */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf-8');

const current = fixture('stopy-procentowe.xml');
const archive = fixture('stopy-archiwum.xml');

describe('parseCurrentReferenceRate', () => {
  it('reads the reference rate and its effective date', () => {
    const [observation, ...rest] = parseCurrentReferenceRate(current);

    expect(rest).toHaveLength(0);
    expect(observation?.indexId).toBe('nbp_reference');
    expect(observation?.effectiveFrom.toString()).toBe('2026-03-05');
    // 3,75% in the file becomes the fraction the domain works in.
    expect(observation?.value.toFixed(4)).toBe('0.0375');
  });

  it('takes only the reference rate, not lombard or deposit', () => {
    // The same file carries `lom` at 4,25% and `dep` at 3,25%; picking the
    // wrong `<pozycja>` would mis-rate every ROR and DOR holding.
    const values = parseCurrentReferenceRate(current).map((o) => o.value.toFixed(4));
    expect(values).toEqual(['0.0375']);
  });
});

describe('parseArchiveReferenceRates', () => {
  it('reads the date from the enclosing group, not the entry', () => {
    const observations = parseArchiveReferenceRates(archive);

    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0]?.effectiveFrom.toString()).toBe('1998-02-26');
    expect(observations[0]?.value.toFixed(4)).toBe('0.2400');
  });

  it('parses every kept block', () => {
    expect(parseArchiveReferenceRates(archive)).toHaveLength(6);
  });

  it('skips a block that carries no reference rate rather than inventing one', () => {
    const withoutRef = `
      <stopy_procentowe_archiwum>
        <pozycje obowiazuje_od="1998-01-01">
          <pozycja id="lom" oprocentowanie="27,00" />
        </pozycje>
        <pozycje obowiazuje_od="1998-02-26">
          <pozycja id="ref" oprocentowanie="24,00" />
        </pozycje>
      </stopy_procentowe_archiwum>`;

    const observations = parseArchiveReferenceRates(withoutRef);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.effectiveFrom.toString()).toBe('1998-02-26');
  });
});

describe('refusing implausible values', () => {
  // A negative or junk value must be *refused*, not quietly skipped by a regex
  // that fails to match it — a skipped entry looks identical to "no change".
  it.each(['250,00', '-1,00', 'brak'])('refuses %s rather than writing it', (rate) => {
    const xml = `<stopy_procentowe_archiwum><pozycje obowiazuje_od="2026-01-01">
      <pozycja id="ref" oprocentowanie="${rate}" /></pozycje></stopy_procentowe_archiwum>`;

    expect(() => parseArchiveReferenceRates(xml)).toThrow(ImplausibleRateError);
  });

  it('accepts 1998’s genuine 24% peak', () => {
    // The band has to admit real history: refusing this would refuse the
    // archive's own opening entry.
    expect(() => parseArchiveReferenceRates(archive)).not.toThrow();
  });
});

describe('mergeReferenceRates', () => {
  it('sorts oldest first and lets the current file win a shared date', () => {
    const merged = mergeReferenceRates(
      parseArchiveReferenceRates(archive),
      parseCurrentReferenceRate(current),
    );

    const dates = merged.map((o) => o.effectiveFrom.toString());
    expect(dates).toEqual([...dates].sort());
    expect(dates.at(-1)).toBe('2026-03-05');
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('deduplicates the overlap between the two files', () => {
    const shared = parseCurrentReferenceRate(current);
    const merged = mergeReferenceRates(shared, shared);
    expect(merged).toHaveLength(1);
  });
});
