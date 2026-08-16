/**
 * XTB suffixes a ticker with the *listing country* (`.PL`, `.US`, `.UK`,
 * `.NL`, `.DE` — every suffix seen across all three of a real user's
 * accounts, EUR/PLN/USD), which is not the market-symbol suffix a search
 * provider actually indexes. Verified live against Yahoo Finance for each:
 * `XTB.PL` finds nothing, `XTB.WA` is the listing. The mapping below is
 * exactly that correction, confirmed the same way per suffix — `.PL`→`.WA`
 * (Warsaw), `.UK`→`.L` (London), `.NL`→`.AS` (Amsterdam), `.US`→ no suffix at
 * all, `.DE` unchanged (Xetra happens to already agree with XTB here).
 *
 * A suffix outside this set is left untouched rather than guessed — the same
 * posture `mapUnrecognized` takes toward an XTB `Type` this parser has never
 * seen evidence for (rule 7's spirit: a correction this parser cannot confirm
 * is not one it should make).
 */
const COUNTRY_SUFFIX_TO_MARKET_SUFFIX: Readonly<Record<string, string | null>> = {
  PL: 'WA',
  UK: 'L',
  NL: 'AS',
  DE: 'DE',
  US: null,
};

/**
 * Without this, every non-German XTB ticker fails both local auto-match
 * (`instruments.symbol` is stored in market-symbol form) and manual search
 * (a provider indexes the market symbol, never XTB's own country suffix) —
 * confirmed against a real 3-account export before this existed.
 */
export function normalizeXtbTicker(ticker: string): string {
  const dot = ticker.lastIndexOf('.');
  if (dot === -1) return ticker;

  const base = ticker.slice(0, dot);
  const suffix = ticker.slice(dot + 1).toUpperCase();
  if (!(suffix in COUNTRY_SUFFIX_TO_MARKET_SUFFIX)) return ticker;

  const mapped = COUNTRY_SUFFIX_TO_MARKET_SUFFIX[suffix]!;
  return mapped === null ? base : `${base}.${mapped}`;
}
