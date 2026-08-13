import YahooFinance from 'yahoo-finance2';

/**
 * v4 broke the v2 default-export API: every call throws `Call \`const
 * yahooFinance = new YahooFinance()\` first` without this instance. One
 * module owns it so nobody rediscovers that error (ADR 0014, section 08).
 */
export const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const MIN_INTERVAL_MS = 1000;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

let nextSlotAt = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes every call to roughly one per second, regardless of caller. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = nextSlotAt - now;
  nextSlotAt = Math.max(nextSlotAt, now) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

function is429(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429');
}

/**
 * Every request to Yahoo goes through this: throttled to ~1/s and retried on
 * `429` with backoff (1s, 4s, 16s — three attempts total). This is a single
 * request's own resilience; the cross-instrument circuit breaker that stops
 * an entire refresh round lives in `core`'s `makeRefreshPrices`, not here.
 */
export async function callYahoo<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await throttle();
    try {
      return await fn();
    } catch (error) {
      if (!is429(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}
