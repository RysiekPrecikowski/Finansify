const CHART_URL = 'https://api.bankier.pl/quotes/public/bankier-tfi/bankier-fund-chart-data';

const MIN_INTERVAL_MS = 1000;
const RETRY_DELAYS_MS = [1000, 4000, 16000];
/** No default request timeout exists in `fetch` — without this, a connection that hangs rather than failing outright stalls a whole retry attempt for however long the runtime's own socket timeout is, which is minutes, not seconds. */
const REQUEST_TIMEOUT_MS = 8000;

let nextSlotAt = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes every call to roughly one per second, regardless of caller — same shape as `gpw/client.ts`. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = nextSlotAt - now;
  nextSlotAt = Math.max(nextSlotAt, now) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

/**
 * Unlike `gpw`'s `chart-json.php`, this endpoint sits behind no WAF at all —
 * verified live with a bare `fetch(url)` carrying no headers whatsoever, no
 * cookies, no `Referer`. A `symbol` it does not recognise answers `200` with
 * an empty series and an empty `profile_data` rather than any error status,
 * so retrying here only ever covers a genuine transport failure or a
 * server-side error, not an unmapped symbol.
 */
export async function fetchBankierFundChart(symbol: string, range: string): Promise<unknown> {
  const url = new URL(CHART_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('range', range);

  for (let attempt = 0; ; attempt += 1) {
    await throttle();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`bankier.pl responded with ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}
