import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { Temporal } from '../time';
import { isIndexSeriesDue, makeRefreshIndexSeries, summarizeIndexSeries } from './index-series';
import { type IndexObservationProvider, type IndexObservationRepository } from './ports';
import { type IndexId, type IndexObservation } from './types';

const date = (iso: string) => Temporal.PlainDate.from(iso);

const observation = (indexId: IndexId, on: string, value: string): IndexObservation => ({
  indexId,
  effectiveFrom: date(on),
  value: new Decimal(value),
});

describe('summarizeIndexSeries', () => {
  const series = [
    observation('pl_cpi_yoy', '2026-06-01', '0.031'),
    observation('pl_cpi_yoy', '2026-08-01', '0.030'),
    observation('pl_cpi_yoy', '2026-07-01', '0.025'),
    observation('nbp_reference', '2026-03-05', '0.0375'),
  ];

  it('takes the newest reading regardless of the order it arrives in', () => {
    const summary = summarizeIndexSeries('pl_cpi_yoy', series);
    expect(summary?.latest.effectiveFrom.toString()).toBe('2026-08-01');
  });

  it('reports the move from the previous reading', () => {
    const summary = summarizeIndexSeries('pl_cpi_yoy', series);
    // 3.0% after 2.5% is a rise of half a point.
    expect(summary?.previous?.effectiveFrom.toString()).toBe('2026-07-01');
    expect(summary?.change?.toFixed(4)).toBe('0.0050');
  });

  it('never mixes the two series together', () => {
    const summary = summarizeIndexSeries('nbp_reference', series);
    expect(summary?.latest.value.toFixed(4)).toBe('0.0375');
    expect(summary?.previous).toBeNull();
    expect(summary?.change).toBeNull();
  });

  it('returns null when nothing is stored for that series', () => {
    expect(summarizeIndexSeries('pl_cpi_yoy', [])).toBeNull();
  });
});

describe('isIndexSeriesDue', () => {
  it('is due when nothing is stored at all', () => {
    expect(isIndexSeriesDue('pl_cpi_yoy', null, date('2026-08-15'))).toBe(true);
    expect(isIndexSeriesDue('nbp_reference', null, date('2026-08-15'))).toBe(true);
  });

  describe('CPI, published monthly', () => {
    it('is not due again within the month of the newest print', () => {
      const newest = observation('pl_cpi_yoy', '2026-08-01', '0.03');
      expect(isIndexSeriesDue('pl_cpi_yoy', newest, date('2026-08-31'))).toBe(false);
    });

    it('is due once the calendar month moves past it', () => {
      const newest = observation('pl_cpi_yoy', '2026-08-01', '0.03');
      expect(isIndexSeriesDue('pl_cpi_yoy', newest, date('2026-09-01'))).toBe(true);
    });
  });

  describe('the reference rate, which moves when the RPP says so', () => {
    it('rechecks on age rather than on the calendar month', () => {
      // A month-based rule would miss a second cut inside the same month.
      const newest = observation('nbp_reference', '2026-03-05', '0.0375');
      expect(isIndexSeriesDue('nbp_reference', newest, date('2026-03-11'))).toBe(false);
      expect(isIndexSeriesDue('nbp_reference', newest, date('2026-03-12'))).toBe(true);
    });
  });
});

describe('makeRefreshIndexSeries', () => {
  function fakes(options: {
    stored?: IndexObservation | null;
    fetched?: readonly IndexObservation[];
    fail?: string;
  }) {
    const saved: IndexObservation[][] = [];
    const repository: IndexObservationRepository = {
      async history() {
        return [];
      },
      async latest() {
        return options.stored ?? null;
      },
      async save(observations) {
        saved.push([...observations]);
      },
    };
    const provider: IndexObservationProvider = {
      name: 'gus',
      indexId: 'pl_cpi_yoy',
      async fetchObservations() {
        if (options.fail !== undefined) throw new Error(options.fail);
        return options.fetched ?? [];
      },
    };
    return { repository, provider, saved };
  }

  const today = () => date('2026-09-15');

  it('does nothing when the series is not due', async () => {
    const { repository, provider, saved } = fakes({
      stored: observation('pl_cpi_yoy', '2026-09-01', '0.03'),
    });

    const report = await makeRefreshIndexSeries({
      repository,
      providers: [provider],
      today,
    })('pl_cpi_yoy');

    expect(report.refreshed).toBe(false);
    expect(saved).toEqual([]);
  });

  it('fetches and saves when it is due', async () => {
    const fetched = [observation('pl_cpi_yoy', '2026-09-01', '0.028')];
    const { repository, provider, saved } = fakes({
      stored: observation('pl_cpi_yoy', '2026-08-01', '0.03'),
      fetched,
    });

    const report = await makeRefreshIndexSeries({
      repository,
      providers: [provider],
      today,
    })('pl_cpi_yoy');

    expect(report).toEqual({ indexId: 'pl_cpi_yoy', refreshed: true, error: null });
    expect(saved).toEqual([fetched]);
  });

  it('reports a provider failure instead of throwing', async () => {
    // The stored series is still servable; a down provider must degrade to
    // "stale, labelled" rather than to an error page.
    const { repository, provider, saved } = fakes({ stored: null, fail: 'GUS responded with 503' });

    const report = await makeRefreshIndexSeries({
      repository,
      providers: [provider],
      today,
    })('pl_cpi_yoy');

    expect(report.refreshed).toBe(false);
    expect(report.error).toContain('503');
    expect(saved, 'a failed fetch must not write').toEqual([]);
  });

  it('refuses to treat an empty response as an empty world', async () => {
    const { repository, provider, saved } = fakes({ stored: null, fetched: [] });

    const report = await makeRefreshIndexSeries({
      repository,
      providers: [provider],
      today,
    })('pl_cpi_yoy');

    expect(report.refreshed).toBe(false);
    expect(report.error).toContain('no observations');
    expect(saved).toEqual([]);
  });

  it('reports rather than throws when no provider is registered', async () => {
    const { repository, provider } = fakes({ stored: null });

    const report = await makeRefreshIndexSeries({
      repository,
      providers: [provider],
      today,
    })('nbp_reference');

    expect(report.error).toContain('nbp_reference');
  });
});
