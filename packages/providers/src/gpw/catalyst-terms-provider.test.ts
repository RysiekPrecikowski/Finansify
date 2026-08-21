import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currency } from '@finansify/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gpwCatalystBondTermsProvider } from './catalyst-terms-provider';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf-8');

describe('gpwCatalystBondTermsProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the nominal value and its currency from a real captured page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(fixture('ghe0128.html')) });
    vi.stubGlobal('fetch', fetchMock);

    const terms = await gpwCatalystBondTermsProvider.fetchTerms('GHE0128');

    expect(terms?.symbol).toBe('GHE0128');
    expect(terms?.nominal.amount.toFixed(2)).toBe('100.00');
    expect(terms?.nominal.currency).toBe(currency('PLN'));
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://gpwcatalyst.pl/o-instrumentach-instrument?nazwa=GHE0128'),
      expect.anything(),
    );
  });

  it('returns null for an unrecognised ticker ("Brak danych"), not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(fixture('nope9999.html')) }),
    );

    const terms = await gpwCatalystBondTermsProvider.fetchTerms('NOPE9999');

    expect(terms).toBeNull();
  });

  it('throws on a non-OK response rather than returning null silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(gpwCatalystBondTermsProvider.fetchTerms('GHE0128')).rejects.toThrow('503');
  });

  it('refuses a page whose nominal value cannot be read as a positive number', async () => {
    // Both occurrences on the real page (the collapsed summary table and the
    // full detail table) need breaking — the regex matches whichever comes
    // first in document order, and the fixture has the summary one first.
    const broken = fixture('ghe0128.html').replaceAll(
      /(Warto[śs][ćc]\s+nominalna\s*\(PLN\)\s*<\/td>\s*<td[^>]*>)100,00(\s*<\/td>)/gi,
      '$1—$2',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(broken) }),
    );

    const terms = await gpwCatalystBondTermsProvider.fetchTerms('GHE0128');

    expect(terms).toBeNull();
  });
});
