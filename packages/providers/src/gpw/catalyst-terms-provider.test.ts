import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currency } from '@finansify/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ fetchGpwCatalystInstrumentPage: vi.fn() }));

import { fetchGpwCatalystInstrumentPage } from './client';
import { gpwCatalystBondTermsProvider } from './catalyst-terms-provider';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf-8');

describe('gpwCatalystBondTermsProvider', () => {
  it('parses the nominal value and its currency from a real captured page', async () => {
    vi.mocked(fetchGpwCatalystInstrumentPage).mockResolvedValue(fixture('ghe0128.html'));

    const terms = await gpwCatalystBondTermsProvider.fetchTerms('GHE0128');

    expect(terms?.symbol).toBe('GHE0128');
    expect(terms?.nominal.amount.toFixed(2)).toBe('100.00');
    expect(terms?.nominal.currency).toBe(currency('PLN'));
    expect(fetchGpwCatalystInstrumentPage).toHaveBeenCalledWith('GHE0128');
  });

  it('returns null for an unrecognised ticker ("Brak danych"), not a throw', async () => {
    vi.mocked(fetchGpwCatalystInstrumentPage).mockResolvedValue(fixture('nope9999.html'));

    const terms = await gpwCatalystBondTermsProvider.fetchTerms('NOPE9999');

    expect(terms).toBeNull();
  });

  it('propagates a fetch failure rather than returning null silently', async () => {
    vi.mocked(fetchGpwCatalystInstrumentPage).mockRejectedValue(
      new Error('gpwcatalyst.pl responded with 503'),
    );

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
    vi.mocked(fetchGpwCatalystInstrumentPage).mockResolvedValue(broken);

    const terms = await gpwCatalystBondTermsProvider.fetchTerms('GHE0128');

    expect(terms).toBeNull();
  });
});
