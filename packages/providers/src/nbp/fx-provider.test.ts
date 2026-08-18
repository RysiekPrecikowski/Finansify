import { currency, Temporal } from '@finansify/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nbpFxRateProvider } from './fx-provider';

describe('nbpFxRateProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the table into per-currency mid rates on the published date', async () => {
    const body = [
      {
        table: 'A',
        no: '156/A/NBP/2026',
        effectiveDate: '2026-08-13',
        rates: [
          { currency: 'dolar amerykański', code: 'USD', mid: 3.7362 },
          { currency: 'euro', code: 'EUR', mid: 4.3058 },
        ],
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', fetchMock);

    const rates = await nbpFxRateProvider.fetchTableTo(currency('PLN'));

    expect(rates).toHaveLength(2);
    const usd = rates.find((rate) => rate.currency === currency('USD'));
    expect(usd?.mid.toString()).toBe('3.7362');
    expect(usd?.date.toString()).toBe('2026-08-13');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nbp.pl/api/exchangerates/tables/a/?format=json',
    );
  });

  it('throws on a non-OK response rather than returning an empty table silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(nbpFxRateProvider.fetchTableTo(currency('PLN'))).rejects.toThrow('503');
  });

  it('rejects a table with an empty rates array rather than returning no rates', async () => {
    const body = [
      {
        table: 'A',
        no: '156/A/NBP/2026',
        effectiveDate: '2026-08-13',
        rates: [],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }),
    );

    await expect(nbpFxRateProvider.fetchTableTo(currency('PLN'))).rejects.toThrow();
  });

  it('refuses a base other than PLN — table A has no other base', async () => {
    await expect(nbpFxRateProvider.fetchTableTo(currency('USD'))).rejects.toThrow();
  });
});

describe('nbpFxRateProvider.fetchSeriesTo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const seriesBody = {
    table: 'A',
    currency: 'dolar amerykański',
    code: 'USD',
    rates: [
      { no: '148/A/NBP/2026', effectiveDate: '2026-08-03', mid: 3.733 },
      { no: '149/A/NBP/2026', effectiveDate: '2026-08-04', mid: 3.7468 },
    ],
  };

  it('asks for the range as one request when it fits, and dates each print', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(seriesBody) });
    vi.stubGlobal('fetch', fetchMock);

    const rates = await nbpFxRateProvider.fetchSeriesTo(
      currency('USD'),
      Temporal.PlainDate.from('2026-08-03'),
      Temporal.PlainDate.from('2026-08-04'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nbp.pl/api/exchangerates/rates/a/usd/2026-08-03/2026-08-04/?format=json',
    );
    expect(rates.map((rate) => rate.date.toString())).toEqual(['2026-08-03', '2026-08-04']);
    expect(rates[0]?.mid.toString()).toBe('3.733');
  });

  it('splits a window wider than 367 days, because NBP answers a longer one with a 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(seriesBody) });
    vi.stubGlobal('fetch', fetchMock);

    await nbpFxRateProvider.fetchSeriesTo(
      currency('USD'),
      Temporal.PlainDate.from('2024-01-01'),
      Temporal.PlainDate.from('2026-01-01'),
    );

    // 731 days: a full 367-day chunk, then the remainder — never a chunk that
    // starts after it ends.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/2024-01-01/2025-01-01/');
    // Contiguous: no day dropped between chunks and none fetched twice.
    expect(urls[1]).toContain('/2025-01-02/2026-01-01/');
  });

  it('treats a 404 as a range with no publications, not as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const rates = await nbpFxRateProvider.fetchSeriesTo(
      currency('USD'),
      Temporal.PlainDate.from('2026-12-24'),
      Temporal.PlainDate.from('2026-12-26'),
    );

    expect(rates).toEqual([]);
  });

  it('still throws on a real upstream failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(
      nbpFxRateProvider.fetchSeriesTo(
        currency('USD'),
        Temporal.PlainDate.from('2026-08-03'),
        Temporal.PlainDate.from('2026-08-04'),
      ),
    ).rejects.toThrow('503');
  });

  it('refuses PLN, which table A has no row for', async () => {
    await expect(
      nbpFxRateProvider.fetchSeriesTo(
        currency('PLN'),
        Temporal.PlainDate.from('2026-08-03'),
        Temporal.PlainDate.from('2026-08-04'),
      ),
    ).rejects.toThrow();
  });
});
