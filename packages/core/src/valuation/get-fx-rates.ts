import { type Clock } from '../ports/clock';
import { currency, type Currency } from '../money';
import { Temporal } from '../time';
import { type FxRateProvider, type FxRateRepository } from './ports';
import { type FxRate, type FxRateLookup, type RefreshReport, type StoredFxRate } from './types';
import { PRICE_TTL_MINUTES } from './get-prices';

function isStale(fetchedAt: Temporal.Instant, now: Temporal.Instant): boolean {
  return now.since(fetchedAt).total('minutes') > PRICE_TTL_MINUTES;
}

function isDue(row: StoredFxRate | undefined, now: Temporal.Instant): boolean {
  return row === undefined || isStale(row.fetchedAt, now);
}

function toLookup(row: StoredFxRate | undefined, now: Temporal.Instant): FxRateLookup {
  if (row === undefined) return { status: 'unavailable' };
  return {
    status: isStale(row.fetchedAt, now) ? 'stale' : 'fresh',
    mid: row.mid,
    asOf: row.date,
    fetchedAt: row.fetchedAt,
  };
}

/** Read-only, same shape and same reason as `makeReadPrices`. */
export function makeReadFxRates(deps: { fx: FxRateRepository; clock: Clock }) {
  return async function readFxRates(
    currencies: readonly Currency[],
  ): Promise<ReadonlyMap<Currency, FxRateLookup>> {
    const stored = await deps.fx.latestFor(currencies);
    const now = deps.clock.now();
    const result = new Map<Currency, FxRateLookup>();
    for (const code of currencies) result.set(code, toLookup(stored.get(code), now));
    return result;
  };
}

/**
 * Same gate as `get-prices.ts`'s: a non-positive rate or one dated in the
 * future is a provider bug, not a rate. `greaterThan(0)` rather than
 * `isPositive()` — `Decimal.isPositive()` treats zero as positive (which is
 * why `Money` overrides it), and a zero mid saved as `fresh` makes every later
 * `convertViaPln` divide by it and yield `Infinity` instead of throwing.
 */
function isUsable(rate: FxRate, now: Temporal.Instant): boolean {
  if (!rate.mid.greaterThan(0)) return false;
  const today = now.toZonedDateTimeISO('UTC').toPlainDate();
  return Temporal.PlainDate.compare(rate.date, today) <= 0;
}

/**
 * NBP table A returns every currency in one call (section 07), so unlike
 * prices there is no per-currency request to skip — either at least one
 * requested currency is due and the whole table is fetched, or none are and
 * the provider is not called at all. No `unmapped`: every ISO currency code
 * is either in the table or it is not, there is nothing to resolve first.
 */
export function makeRefreshFxRates(deps: {
  fx: FxRateRepository;
  provider: FxRateProvider;
  clock: Clock;
}) {
  return async function refreshFxRates(
    currencies: readonly Currency[],
  ): Promise<RefreshReport<Currency>> {
    const now = deps.clock.now();
    const stored = await deps.fx.latestFor(currencies);
    const due = currencies.filter((code) => isDue(stored.get(code), now));

    if (due.length === 0) return { refreshed: [], unmapped: [], failed: [] };

    try {
      const rates = await deps.provider.fetchTableTo(currency('PLN'));
      const usable = rates.filter((rate) => isUsable(rate, now));
      await deps.fx.save(usable, deps.provider.name);
      const returned = new Set(usable.map((rate) => rate.currency));
      return {
        refreshed: due.filter((code) => returned.has(code)),
        unmapped: [],
        failed: due.filter((code) => !returned.has(code)),
      };
    } catch {
      return { refreshed: [], unmapped: [], failed: due };
    }
  };
}
