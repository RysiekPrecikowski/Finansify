import {
  currency,
  Money,
  type CatalystBondTerms,
  type CatalystBondTermsProvider,
} from '@finansify/core';
import Decimal from 'decimal.js';

const INSTRUMENT_PAGE = 'https://gpwcatalyst.pl/o-instrumentach-instrument';

/**
 * "Wartość nominalna (PLN)</td><td>100,00</td>" — the currency rides along in
 * the label rather than in a column of its own, and the value is Polish
 * comma-decimal. Matched against the raw markup rather than flattened text:
 * the `</td><td>` boundary is what pins the label to *its* value instead of
 * the next row's, which flattening (`mf/bond-issue-provider.ts`'s approach)
 * would blur into one run of whitespace-joined numbers.
 */
const NOMINAL =
  /Warto[śs][ćc]\s+nominalna\s*\(([A-Za-z]{3})\)\s*<\/td>\s*<td[^>]*>([\d\s.,]+)\s*<\/td>/i;

function parseNominal(html: string): { amount: Decimal; currencyCode: string } | null {
  const match = NOMINAL.exec(html);
  if (!match) return null;

  const [, currencyCode, raw] = match;
  const normalized = raw!.trim().replace(/\s/g, '').replace(',', '.');

  let amount: Decimal;
  try {
    amount = new Decimal(normalized);
  } catch {
    return null;
  }
  if (!amount.isFinite() || amount.isNegative()) return null;

  return { amount, currencyCode: currencyCode!.toUpperCase() };
}

/**
 * GPW's Catalyst instrument page, one GET, keyed by ticker (`nazwa`) rather
 * than ISIN — the identifier `chart-json.php` uses is a different one
 * entirely (ADR 0023). An unrecognised ticker renders "Brak danych" with no
 * nominal row at all, which the regex simply fails to match — no separate
 * not-found branch needed, same as `mf/bond-issue-provider.ts`'s stance that
 * a page not matching the expected shape is `null`, not a guess.
 */
export const gpwCatalystBondTermsProvider: CatalystBondTermsProvider = {
  name: 'gpw',

  async fetchTerms(symbol: string): Promise<CatalystBondTerms | null> {
    const url = new URL(INSTRUMENT_PAGE);
    url.searchParams.set('nazwa', symbol);

    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`gpwcatalyst.pl responded with ${response.status}`);

    const html = await response.text();
    const parsed = parseNominal(html);
    if (parsed === null) return null;

    return { symbol, nominal: Money.of(parsed.amount, currency(parsed.currencyCode)) };
  },
};
