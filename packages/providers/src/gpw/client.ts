const CHART_URL = 'https://www.gpw.pl/chart-json.php';

const MIN_INTERVAL_MS = 1000;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

let nextSlotAt = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes every call to roughly one per second, regardless of caller — same shape as `yahoo/client.ts`. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = nextSlotAt - now;
  nextSlotAt = Math.max(nextSlotAt, now) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

/**
 * `chart-json.php` sits behind a WAF that resets the TCP connection outright
 * — no `429`, no body — for requests that don't look like a browser tab
 * navigating from the instrument's own page. Verified live: a bare
 * `fetch(url)` with only `User-Agent` is refused; adding `Referer` and the
 * `Sec-Fetch-*` triad (what a real same-origin XHR sends) is answered.
 */
function headersFor(isin: string): Record<string, string> {
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: `https://www.gpw.pl/spolka?isin=${isin}`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  };
}

/**
 * One request, one instrument, one window — `chart-json.php` accepts a batch
 * (`req` is an array), but nothing in this adapter needs more than one entry
 * per call, so the array is always length 1 in and length 1 out.
 *
 * Retries on both a non-OK response and a network-level failure (the reset
 * above throws from `fetch` itself, before any status code exists) — unlike
 * Yahoo's `is429`, there is no status code to distinguish "back off" from
 * "gone", so every failure gets the same backoff.
 */
export async function fetchGpwChart(isin: string, mode: string): Promise<unknown> {
  const url = new URL(CHART_URL);
  url.searchParams.set('req', JSON.stringify([{ isin, mode }]));

  for (let attempt = 0; ; attempt += 1) {
    await throttle();
    try {
      const response = await fetch(url, { headers: headersFor(isin) });
      if (!response.ok) throw new Error(`GPW responded with ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}
