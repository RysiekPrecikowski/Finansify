import {
  currency,
  Money,
  type CatalystBondCandidate,
  type CatalystBondListing,
  type CatalystBondLookup,
} from '@finansify/core';

import { fetchGpwCatalystInstrumentPage, fetchGpwCorporateBondsList } from './client';
import { parseNominal } from './catalyst-terms-provider';

/**
 * Walks issuer and ticker links in document order rather than parsing
 * `<tr>`/`<td>` structure: the issuer cell is `rowspan`-grouped (one cell
 * covers every bond from that issuer), so a ticker with no issuer link
 * between it and the previous one belongs to whichever issuer came last.
 * The page repeats this table 2-3 times (a hidden variant feeds the "download
 * as Excel" button) — `search` dedupes by ticker, keeping the first hit.
 */
const ENTRY =
  /<a href="emitenci-obligacji-karta\?nazwa=[^"]*">([^<]+)<\/a>|<a href="o-instrumentach-instrument\?nazwa=([A-Za-z0-9_]+)">/g;

function parseCorporateBondsListing(html: string): readonly CatalystBondCandidate[] {
  const seen = new Set<string>();
  const candidates: CatalystBondCandidate[] = [];
  let issuerName: string | null = null;

  for (const match of html.matchAll(ENTRY)) {
    const [, issuer, ticker] = match;
    if (issuer !== undefined) {
      issuerName = issuer.trim();
      continue;
    }
    if (ticker === undefined || issuerName === null || seen.has(ticker)) continue;
    seen.add(ticker);
    candidates.push({ ticker, issuerName });
  }

  return candidates;
}

const ISIN = /id="isin"\s+value="([A-Z0-9]+)"/;
const ISSUER_NAME = /Nazwa emitenta\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i;

function parseListing(ticker: string, html: string): CatalystBondListing | null {
  const isin = ISIN.exec(html)?.[1];
  const issuerName = ISSUER_NAME.exec(html)?.[1]?.trim();
  const nominal = parseNominal(html);
  if (isin === undefined || issuerName === undefined || nominal === null) return null;

  return {
    ticker,
    isin,
    issuerName,
    nominal: Money.of(nominal.amount, currency(nominal.currencyCode)),
  };
}

/**
 * The board changes at most once a day; re-downloading ~1.5 MB on every
 * keystroke was the actual cause of a 50+ second search hang (the parsed
 * candidates cost nothing to keep, so this caches those, not the raw HTML).
 * A module-level TTL, same idiom as this module's own `throttle` — no
 * framework caching (`use cache`) reaches into `packages/providers`, which
 * knows nothing about Next.js (`AGENTS.md`, rule 2).
 */
const LISTING_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let cachedListing:
  { readonly candidates: readonly CatalystBondCandidate[]; readonly expiresAt: number } | undefined;
let listingInFlight: Promise<readonly CatalystBondCandidate[]> | undefined;

/** Concurrent searches while the cache is cold share one fetch instead of one each. Only a success populates the cache — a failure is retried on the next call rather than remembered. */
async function corporateBondsListing(): Promise<readonly CatalystBondCandidate[]> {
  if (cachedListing !== undefined && cachedListing.expiresAt > Date.now()) {
    return cachedListing.candidates;
  }
  listingInFlight ??= (async () => {
    const html = await fetchGpwCorporateBondsList();
    const candidates = parseCorporateBondsListing(html);
    cachedListing = { candidates, expiresAt: Date.now() + LISTING_CACHE_TTL_MS };
    return candidates;
  })().finally(() => {
    listingInFlight = undefined;
  });
  return listingInFlight;
}

/**
 * Search and confirmation for Catalyst-listed corporate bonds (Stage 6),
 * scraped off `gpwcatalyst.pl` — the site has no search API of its own
 * (checked: only full per-segment listing pages), so `search()` fetches the
 * whole corporate-bond board (~640 rows) and filters in memory, through the
 * cache above.
 * Municipal, covered, cooperative and convertible bonds sit on separate
 * listing pages and are a deliberate scope cut, not fetched here.
 */
export const gpwCatalystBondLookup: CatalystBondLookup = {
  name: 'gpw',

  async search(query: string): Promise<readonly CatalystBondCandidate[]> {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];

    const candidates = await corporateBondsListing();
    return candidates.filter(
      (candidate) =>
        candidate.ticker.toLowerCase().includes(needle) ||
        candidate.issuerName.toLowerCase().includes(needle),
    );
  },

  async fetchListing(ticker: string): Promise<CatalystBondListing | null> {
    const html = await fetchGpwCatalystInstrumentPage(ticker);
    return parseListing(ticker, html);
  },
};
