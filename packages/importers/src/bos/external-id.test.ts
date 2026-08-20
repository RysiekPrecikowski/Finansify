import Decimal from 'decimal.js';
import { currency, Temporal } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { type BosRow } from './csv-rows';
import { makeExternalIdFactory } from './external-id';

function row(overrides: Partial<BosRow> = {}): BosRow {
  return {
    date: Temporal.PlainDate.from('2026-01-05'),
    title: 'Przelew do DM BOŚ',
    details: '',
    amount: new Decimal(5000),
    currency: currency('PLN'),
    lineIndex: 0,
    ...overrides,
  };
}

describe('makeExternalIdFactory', () => {
  it('gives two rows with identical content distinct ids, via an occurrence counter', () => {
    const externalIdFor = makeExternalIdFactory();
    const a = row();
    const b = row({ lineIndex: 1 });

    const idA = externalIdFor(a);
    const idB = externalIdFor(b);

    expect(idA).not.toBe(idB);
  });

  it('never collides for rows differing only in date', () => {
    const externalIdFor = makeExternalIdFactory();

    const idA = externalIdFor(row({ date: Temporal.PlainDate.from('2026-01-05') }));
    const idB = externalIdFor(row({ date: Temporal.PlainDate.from('2026-01-06') }));

    expect(idA).not.toBe(idB);
  });

  it('never collides for rows differing only in title', () => {
    const externalIdFor = makeExternalIdFactory();

    const idA = externalIdFor(row({ title: 'Przelew do DM BOŚ' }));
    const idB = externalIdFor(row({ title: 'Wypłata dywidendy brutto ETFSP500' }));

    expect(idA).not.toBe(idB);
  });

  it('never collides for rows differing only in details', () => {
    const externalIdFor = makeExternalIdFactory();

    const idA = externalIdFor(row({ details: 'a' }));
    const idB = externalIdFor(row({ details: 'b' }));

    expect(idA).not.toBe(idB);
  });

  it('never collides for rows differing only in amount', () => {
    const externalIdFor = makeExternalIdFactory();

    const idA = externalIdFor(row({ amount: new Decimal(100) }));
    const idB = externalIdFor(row({ amount: new Decimal(200) }));

    expect(idA).not.toBe(idB);
  });

  it('never collides for rows differing only in currency', () => {
    const externalIdFor = makeExternalIdFactory();

    const idA = externalIdFor(row({ currency: currency('PLN') }));
    const idB = externalIdFor(row({ currency: currency('EUR') }));

    expect(idA).not.toBe(idB);
  });

  it('is stable: a fresh factory fed the same rows in the same order produces the same ids', () => {
    const rows = [
      row({ lineIndex: 0 }),
      row({ lineIndex: 1 }), // identical content to the first — same-content dedup case
      row({
        lineIndex: 2,
        title: 'Rozliczenie transakcji kupna:',
        details: 'x',
        amount: new Decimal(-100),
      }),
    ];

    const firstFactory = makeExternalIdFactory();
    const idsFirstRun = rows.map((r) => firstFactory(r));
    const secondFactory = makeExternalIdFactory();
    const idsSecondRun = rows.map((r) => secondFactory(r));

    expect(idsSecondRun).toEqual(idsFirstRun);
  });

  it('assigns increasing occurrence numbers to repeated identical-content rows, in call order', () => {
    const externalIdFor = makeExternalIdFactory();
    const same = row();

    const first = externalIdFor(same);
    const second = externalIdFor(same);
    const third = externalIdFor(same);

    expect(first).toMatch(/ 0$/);
    expect(second).toMatch(/ 1$/);
    expect(third).toMatch(/ 2$/);
  });

  it('is stable across the same content but a different lineIndex (lineIndex is not part of the key)', () => {
    const externalIdFor = makeExternalIdFactory();

    const idA = externalIdFor(row({ lineIndex: 0 }));
    const idB = externalIdFor(row({ lineIndex: 99 }));

    // Same content -> same key -> distinguished only by occurrence counter, not lineIndex.
    expect(idA).toMatch(/ 0$/);
    expect(idB).toMatch(/ 1$/);
  });

  it('prefixes every id with "bos:"', () => {
    const externalIdFor = makeExternalIdFactory();

    expect(externalIdFor(row())).toMatch(/^bos:/);
  });
});
