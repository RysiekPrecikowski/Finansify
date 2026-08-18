import {
  currency as toCurrency,
  makeReadFxRates,
  makeRefreshFxQuotes,
  makeRefreshFxRates,
  valuationSource,
  type Currency,
  type FxRateLookup,
  type FxSourcePreference,
} from '@finansify/core';

import { clock, getFxProvider, getFxQuoteProvider, getFxRates } from '@/server/container';

const PLN = toCurrency('PLN');
const displayTimeZone = 'Europe/Warsaw';

/**
 * Current rates to PLN for a valuation, from whichever source the reader's
 * preference resolves to.
 *
 * One place, because the alternative is each page composing its own reader and
 * one of them eventually forgetting the preference — which would not fail, it
 * would just value that page's portfolio at a different rate than the next
 * page's. `valuationSource` applies the scope: under `charts` this is NBP
 * whatever the reader picked to look at (ADR 0018).
 *
 * The two refresh paths differ because the upstreams do. NBP returns the whole
 * table in one request, so `refreshFxRates` asks once for everything; Yahoo
 * quotes one pair per request, so `refreshFxQuotes` walks the currencies and
 * reports the ones it has no quote for rather than guessing them.
 */
export async function readValuationRates(
  currencies: readonly Currency[],
  preference: FxSourcePreference,
): Promise<ReadonlyMap<Currency, FxRateLookup>> {
  const wanted = [...new Set(currencies)].filter((code) => code !== PLN);
  if (wanted.length === 0) return new Map();

  const source = valuationSource(preference);
  const fx = getFxRates();
  const readFxRates = makeReadFxRates({ fx, clock, source });

  let lookups = await readFxRates(wanted);
  if (!wanted.some((code) => lookups.get(code)?.status !== 'fresh')) return lookups;

  if (source === 'yahoo') {
    const refreshFxQuotes = makeRefreshFxQuotes({
      fx,
      provider: getFxQuoteProvider(),
      clock,
      timeZone: displayTimeZone,
    });
    await refreshFxQuotes(wanted);
  } else {
    const refreshFxRates = makeRefreshFxRates({ fx, provider: getFxProvider(), clock });
    await refreshFxRates(wanted);
  }

  lookups = await readFxRates(wanted);
  return lookups;
}
