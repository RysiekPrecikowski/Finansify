import { type Clock } from '../ports/clock';
import { currency, type Currency } from '../money';
import { type Temporal } from '../time';
import { type FxQuoteProvider, type FxRateRepository } from './ports';
import { type FxRate } from './types';

const PLN = currency('PLN');

/**
 * How long a market quote stays usable before it is re-asked.
 *
 * The same fifteen minutes as prices, and for the same reason: it is cheap and
 * correct rather than clever. A market rate does move continuously, so unlike
 * the NBP fixing this TTL is a genuine freshness bound rather than a polling
 * interval that keeps returning the same row.
 */
export const FX_QUOTE_TTL_MINUTES = 15;

export interface FxQuoteRefreshReport {
  readonly refreshed: readonly Currency[];
  /** Currencies the provider had no quote for — shown as unvaluable, never guessed. */
  readonly unavailable: readonly Currency[];
  readonly error: string | null;
}

/**
 * Fetch market rates *to PLN* for the given currencies and store them under the
 * provider's own source, so they sit beside the NBP mids rather than on top of
 * them (`fx_rates` is keyed by source — ADR 0018).
 *
 * Normalised to PLN on purpose. Every valuation in this app converts through
 * PLN (`convertViaPln`), so storing `X/PLN` keeps the market path and the NBP
 * path interchangeable at the point of use: swapping the source swaps which
 * rows come back and nothing else.
 *
 * Dated by the *session day in Warsaw*, not by the quote's own instant. The
 * table's grain is a day per currency per source, and a rate quoted at 10:00
 * and again at 16:00 is the same day's rate, revised — which is exactly what
 * the upsert on the primary key expresses.
 */
export function makeRefreshFxQuotes(deps: {
  readonly fx: FxRateRepository;
  readonly provider: FxQuoteProvider;
  readonly clock: Clock;
  readonly timeZone: string;
}) {
  const { fx, provider, clock, timeZone } = deps;

  return async function refreshFxQuotes(
    currencies: readonly Currency[],
  ): Promise<FxQuoteRefreshReport> {
    const wanted = [...new Set(currencies)].filter((code) => code !== PLN);
    if (wanted.length === 0) return { refreshed: [], unavailable: [], error: null };

    const now = clock.now();
    const today = now.toZonedDateTimeISO(timeZone).toPlainDate();

    const stored = await fx.latestFor(wanted, provider.name);
    const due = wanted.filter((code) => isQuoteDue(stored.get(code)?.fetchedAt, now));
    if (due.length === 0) return { refreshed: [], unavailable: [], error: null };

    const rates: FxRate[] = [];
    const unavailable: Currency[] = [];

    for (const code of due) {
      try {
        const quote = await provider.fetchSpot({ base: code, quote: PLN });
        // No quote is not a failure of the round — a provider that does not
        // cover one currency still covers the rest, and this one shows as
        // unvaluable rather than taking the others down with it (rule 7).
        if (quote === null) {
          unavailable.push(code);
          continue;
        }
        rates.push({ currency: code, date: today, mid: quote.rate });
      } catch (cause) {
        // A thrown error is different: a rate limit or an outage will hit every
        // remaining currency too, so the round stops and reports rather than
        // hammering. Whatever was fetched before it is still saved.
        if (rates.length > 0) await fx.save(rates, provider.name);
        return {
          refreshed: rates.map((rate) => rate.currency),
          unavailable,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }

    if (rates.length > 0) await fx.save(rates, provider.name);
    return { refreshed: rates.map((rate) => rate.currency), unavailable, error: null };
  };
}

export function isQuoteDue(
  fetchedAt: Temporal.Instant | undefined,
  now: Temporal.Instant,
): boolean {
  if (fetchedAt === undefined) return true;
  return now.since(fetchedAt).total('minutes') > FX_QUOTE_TTL_MINUTES;
}
