import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { Temporal } from '../time';
import { makeResolveBondTerms } from './resolve-bond-terms';
import { parseSeriesCode } from './series-code';
import {
  type BondIssueParameterProvider,
  type BondIssueParameterRepository,
  type BondIssueParameters,
} from './ports';
import { type BondSeriesCode } from './types';

const code = (value: string): BondSeriesCode => parseSeriesCode(value).code;
const date = (iso: string) => Temporal.PlainDate.from(iso);

/** In-memory fakes of the ports — no database, no network (`packages/core/CLAUDE.md`). */
function fakeRepository(seed: BondIssueParameters[] = []) {
  const rows = new Map(seed.map((p) => [p.seriesCode, p]));
  const saves: BondIssueParameters[] = [];
  const repository: BondIssueParameterRepository = {
    async find(codes) {
      const found = new Map<BondSeriesCode, BondIssueParameters>();
      for (const c of codes) {
        const row = rows.get(c);
        if (row !== undefined) found.set(c, row);
      }
      return found;
    },
    async save(parameters) {
      saves.push(parameters);
      rows.set(parameters.seriesCode, parameters);
    },
  };
  return { repository, saves };
}

function fakeProvider(answer: BondIssueParameters | null) {
  const calls: BondSeriesCode[] = [];
  const provider: BondIssueParameterProvider = {
    name: 'mf',
    async fetchIssueParameters(c) {
      calls.push(c);
      return answer;
    },
  };
  return { provider, calls };
}

const edoParams: BondIssueParameters = {
  seriesCode: code('EDO0836'),
  firstPeriodRate: new Decimal('0.0535'),
  margin: new Decimal('0.02'),
};

describe('makeResolveBondTerms', () => {
  it('serves a cached series without touching the provider', () => {
    const { repository } = fakeRepository([edoParams]);
    const { provider, calls } = fakeProvider(null);

    return makeResolveBondTerms({ repository, provider })
      .resolve(code('EDO0836'), date('2026-08-01'))
      .then((terms) => {
        expect(terms?.firstPeriodRate.toFixed(4)).toBe('0.0535');
        expect(calls, 'a cache hit must not hit the network').toEqual([]);
      });
  });

  it('fetches once on a miss and writes it back for everyone else', async () => {
    const { repository, saves } = fakeRepository();
    const { provider, calls } = fakeProvider(edoParams);
    const resolver = makeResolveBondTerms({ repository, provider });

    await resolver.resolve(code('EDO0836'), date('2026-08-01'));
    await resolver.resolve(code('EDO0836'), date('2026-08-01'));

    expect(calls).toHaveLength(1);
    expect(saves).toHaveLength(1);
  });

  it('composes family rules from the purchase date, not from the cached row', async () => {
    // The whole reason the cache stores parameters rather than composed terms:
    // the same series bought either side of the 2024 fee revision faces a
    // different early-redemption fee.
    const { repository } = fakeRepository([edoParams]);
    const { provider } = fakeProvider(null);
    const resolver = makeResolveBondTerms({ repository, provider });

    const older = await resolver.resolve(code('EDO0836'), date('2024-08-31'));
    const newer = await resolver.resolve(code('EDO0836'), date('2024-09-01'));

    expect(older?.rules.earlyRedemption).toMatchObject({ kind: 'fee' });
    expect(newer?.rules.earlyRedemption).toMatchObject({ kind: 'fee' });
    if (older?.rules.earlyRedemption.kind !== 'fee') throw new Error('expected a fee');
    if (newer?.rules.earlyRedemption.kind !== 'fee') throw new Error('expected a fee');

    expect(older.rules.earlyRedemption.amountPerBond.amount.toFixed(2)).toBe('2.00');
    expect(newer.rules.earlyRedemption.amountPerBond.amount.toFixed(2)).toBe('3.00');
  });

  it('returns null when the issue cannot be resolved, and caches nothing', async () => {
    const { repository, saves } = fakeRepository();
    const { provider } = fakeProvider(null);

    const terms = await makeResolveBondTerms({ repository, provider }).resolve(
      code('EDO0125'),
      date('2015-01-01'),
    );

    expect(terms).toBeNull();
    expect(saves, 'an unresolved series must not poison the shared cache').toEqual([]);
  });

  it('rejects a series code that is not one', async () => {
    const { repository } = fakeRepository();
    const { provider } = fakeProvider(null);

    await expect(
      makeResolveBondTerms({ repository, provider }).resolve(
        'NOPE9999' as BondSeriesCode,
        date('2026-08-01'),
      ),
    ).rejects.toThrow();
  });
});
