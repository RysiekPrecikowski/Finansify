import { currency, Money } from '@finansify/core';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { catalystBondTermsRepository } from './bond-repository';
import { type Database } from './client';
import { type CatalystBondTermsRow } from './schema/bonds';

const FETCHED_AT = new Date('2026-01-01T00:00:00.000Z');

function catalystBondTermsRow(overrides: Partial<CatalystBondTermsRow> = {}): CatalystBondTermsRow {
  return {
    symbol: 'GHE0128',
    nominal: '100.00000000',
    currency: 'PLN',
    source: 'gpw',
    resolvedAt: FETCHED_AT,
    ...overrides,
  };
}

/** A `select().from().where()` chain that resolves directly — `find`'s shape. */
function makeWhereResolvedSelectChain<Row>(rows: Row[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const fn = vi.fn().mockReturnValue({ from });
  return { fn, from, where };
}

/** An `insert().values().onConflictDoUpdate()` chain — `save`'s shape. */
function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate };
}

describe('catalystBondTermsRepository', () => {
  describe('find', () => {
    it('returns an empty map without querying for an empty symbol list', async () => {
      const select = vi.fn();
      const repo = catalystBondTermsRepository({ select } as unknown as Database);

      const result = await repo.find([]);

      expect(result.size).toBe(0);
      expect(select).not.toHaveBeenCalled();
    });

    it('reads nominal back as Money in the stored currency', async () => {
      const { fn: select } = makeWhereResolvedSelectChain([catalystBondTermsRow()]);
      const repo = catalystBondTermsRepository({ select } as unknown as Database);

      const result = await repo.find(['GHE0128']);

      const terms = result.get('GHE0128');
      expect(terms?.nominal.amount.toFixed(2)).toBe('100.00');
      expect(terms?.nominal.currency).toBe(currency('PLN'));
    });
  });

  describe('save', () => {
    it('writes the nominal as a fixed-scale string and does not touch it on conflict', async () => {
      const { insert, values, onConflictDoUpdate } = makeInsertChain();
      const repo = catalystBondTermsRepository({ insert } as unknown as Database);

      await repo.save({ symbol: 'GHE0128', nominal: Money.of('100', currency('PLN')) }, 'gpw');

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'GHE0128',
          nominal: '100.00000000',
          currency: 'PLN',
          source: 'gpw',
        }),
      );
      const target = (onConflictDoUpdate as Mock).mock.calls[0]![0].target;
      expect(target).toBeDefined();
    });
  });
});
