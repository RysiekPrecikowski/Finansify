import { currency } from '@finansify/core';
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

  it('refuses a base other than PLN — table A has no other base', async () => {
    await expect(nbpFxRateProvider.fetchTableTo(currency('USD'))).rejects.toThrow();
  });
});
