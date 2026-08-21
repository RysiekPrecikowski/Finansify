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

const CATALYST_HEADERS: Record<string, string> = {
  Accept: 'text/html',
  'Accept-Language': 'pl-PL,pl;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
};

/**
 * `gpwcatalyst.pl` — a different GPW site from `chart-json.php`'s, with no
 * WAF of its own (verified live: the plain headers below are answered with
 * no `Referer`/`Sec-Fetch-*` needed, unlike `chart-json.php`). Shares this
 * module's throttle: both sites are GPW's own infrastructure, so one
 * combined rate limit rather than two independent ones hitting the same
 * origin family.
 */
async function fetchGpwCatalystPage(url: URL): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    await throttle();
    try {
      const response = await fetch(url, { headers: CATALYST_HEADERS });
      if (!response.ok) throw new Error(`gpwcatalyst.pl responded with ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/** `nazwa` is the Catalyst ticker (ADR 0023) — a different identifier from `chart-json.php`'s ISIN. */
export async function fetchGpwCatalystInstrumentPage(ticker: string): Promise<string> {
  const url = new URL('https://gpwcatalyst.pl/o-instrumentach-instrument');
  url.searchParams.set('nazwa', ticker);
  return fetchGpwCatalystPage(url);
}

/**
 * The corporate-bonds segment's full listing — every issuer and ticker on
 * Catalyst's corporate-bond board, one page (~1.5 MB, confirmed live: ~640
 * rows). There is no lighter search-only endpoint on this site (checked);
 * `catalyst-bond-lookup.ts` filters this in memory. Municipal, covered,
 * cooperative and convertible bonds sit on their own listing pages and are
 * not fetched here — a deliberate scope cut (Stage 6), not an oversight.
 */
export async function fetchGpwCorporateBondsList(): Promise<string> {
  return fetchGpwCatalystPage(
    new URL('https://gpwcatalyst.pl/notowania-obligacji-obligacje-korporacyjne'),
  );
}
