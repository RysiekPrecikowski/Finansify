import {
  currency,
  type ConfirmedCandidate,
  type InstrumentCandidate,
  type InstrumentSearchProvider,
} from '@finansify/core';
import { z } from 'zod';

import { fetchBankierFundChart } from './client';

const SEARCH_URL = 'https://api.bankier.pl/quotes/public/instrument-search/';

const hitSchema = z.object({ kod: z.string(), nazwa_skrocona: z.string() });
const ppkHitSchema = z.object({ code: z.string(), shortened_name: z.string() });

const searchResponseSchema = z.object({
  funds_tfi: z.array(hitSchema).optional(),
  ppk: z.array(ppkHitSchema).optional(),
});

const chartCurrencySchema = z.object({
  data: z.array(
    z.object({ profile_data: z.object({ currency: z.string().optional() }).optional() }),
  ),
});

async function fetchBankierSearch(query: string): Promise<z.infer<typeof searchResponseSchema>> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('bankier', 'true');
  url.searchParams.set('query', query);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`bankier.pl instrument search responded with ${response.status}`);
  }
  return searchResponseSchema.parse(await response.json());
}

function candidateOf(symbol: string, name: string): InstrumentCandidate {
  return {
    provider: 'bankier',
    symbol,
    name,
    exchange: null,
    currency: null,
    kind: 'fund',
    isin: null,
  };
}

/**
 * bankier.pl's own instrument search — the source for TFI fund and PPK
 * candidates, neither of which Yahoo indexes at all (verified live: it has
 * nothing for a Polish PPK subfund). `funds_tfi` and `ppk` are two separate
 * arrays in the same response but map onto the same `fund` `InstrumentKind`
 * here — PPK is a tax wrapper, not a kind (`ledger/vocabulary.ts`).
 *
 * Unlike GPW's Catalyst bonds, a bankier fund has exactly one identifier
 * (its own `kod`/`code`) used both to find it and to fetch its price
 * (`bankierPriceProvider`, Stage 4) — no dual-identifier problem, so this
 * goes through the ordinary `InstrumentSearchProvider` → `selectInstrument`
 * flow unchanged, same as Yahoo.
 */
export const bankierInstrumentSearch: InstrumentSearchProvider = {
  name: 'bankier',

  async search(query: string): Promise<readonly InstrumentCandidate[]> {
    const result = await fetchBankierSearch(query);
    const funds = (result.funds_tfi ?? []).map((hit) => candidateOf(hit.kod, hit.nazwa_skrocona));
    const ppk = (result.ppk ?? []).map((hit) => candidateOf(hit.code, hit.shortened_name));
    return [...funds, ...ppk];
  },

  /**
   * The hard gate (ADR 0014), in the shape bankier's API allows: there is no
   * single "confirm this exact instrument" call, so this re-runs `search()`
   * with the candidate's own `symbol` as the query and requires an **exact**
   * `kod`/`code` match — never the candidate's own `name`, which is
   * unverified form data (same reasoning as `yahoo/search-instruments.ts`).
   * Currency comes from a second, independent fetch — `bankier-fund-chart-
   * data`'s `profile_data.currency` — since the search response never
   * carries one.
   */
  async confirm(candidate: InstrumentCandidate): Promise<ConfirmedCandidate | null> {
    const result = await fetchBankierSearch(candidate.symbol);
    const fund = (result.funds_tfi ?? []).find((hit) => hit.kod === candidate.symbol);
    const ppk = (result.ppk ?? []).find((hit) => hit.code === candidate.symbol);
    const match = fund ?? ppk;
    if (match === undefined) return null;
    const name = 'kod' in match ? match.nazwa_skrocona : match.shortened_name;

    const raw = await fetchBankierFundChart(candidate.symbol, '1m');
    const parsed = chartCurrencySchema.safeParse(raw);
    const responseCurrency = parsed.success
      ? parsed.data.data[0]?.profile_data?.currency
      : undefined;
    if (responseCurrency === undefined) return null;

    return {
      provider: 'bankier',
      symbol: candidate.symbol,
      name,
      exchange: null,
      currency: currency(responseCurrency),
      kind: 'fund',
      isin: null,
    };
  },
};
