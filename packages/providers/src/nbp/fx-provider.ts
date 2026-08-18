import {
  currency,
  Temporal,
  type Currency,
  type FxRate,
  type FxRateProvider,
} from '@finansify/core';
import Decimal from 'decimal.js';
import { z } from 'zod';

const NBP_TABLE_A_URL = 'https://api.nbp.pl/api/exchangerates/tables/a/?format=json';

const tableSchema = z.object({
  effectiveDate: z.string(),
  // `mid` is a raw JSON number here, not a `Money`/`Decimal` value — rule 1
  // governs arithmetic inside `core`, and this is `z.number()` parsing NBP's
  // own response shape one line before `new Decimal(entry.mid)` converts it,
  // never a value this adapter computes with.
  rates: z.array(z.object({ code: z.string().length(3), mid: z.number() })).min(1),
});

/** One documented, unauthenticated endpoint — a library buys nothing here (ADR 0014). */
export const nbpFxRateProvider: FxRateProvider = {
  name: 'nbp',

  async fetchTableTo(base: Currency): Promise<readonly FxRate[]> {
    const pln = currency('PLN');
    if (base !== pln) {
      throw new Error(`NBP table A is PLN-based only; got a request for ${base}`);
    }

    const response = await fetch(NBP_TABLE_A_URL);
    if (!response.ok) throw new Error(`NBP responded with ${response.status}`);

    const [table] = z
      .array(tableSchema)
      .min(1)
      .parse(await response.json());
    const date = Temporal.PlainDate.from(table!.effectiveDate);

    return table!.rates.map((entry) => ({
      currency: currency(entry.code),
      date,
      mid: new Decimal(entry.mid),
    }));
  },

  async fetchSeriesTo(
    code: Currency,
    from: Temporal.PlainDate,
    to: Temporal.PlainDate,
  ): Promise<readonly FxRate[]> {
    if (code === currency('PLN')) {
      throw new Error('NBP table A is PLN-based; there is no PLN series to fetch');
    }
    if (Temporal.PlainDate.compare(from, to) > 0) {
      throw new Error(`NBP range starts after it ends: ${from.toString()}..${to.toString()}`);
    }

    const rates: FxRate[] = [];
    for (const chunk of chunkRange(from, to)) {
      rates.push(...(await fetchChunk(code, chunk.from, chunk.to)));
    }
    return rates;
  },
};

/**
 * NBP refuses a range wider than 367 days with a `400`, so a longer window is
 * split rather than clamped — a five-year chart is five requests, not a
 * truncated year. 367 rather than 366: the documented limit is inclusive of
 * both endpoints and covers a leap year plus its bracketing day.
 */
const MAX_RANGE_DAYS = 367;

function chunkRange(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): readonly { from: Temporal.PlainDate; to: Temporal.PlainDate }[] {
  const chunks: { from: Temporal.PlainDate; to: Temporal.PlainDate }[] = [];

  let start = from;
  while (Temporal.PlainDate.compare(start, to) <= 0) {
    const candidate = start.add({ days: MAX_RANGE_DAYS - 1 });
    const end = Temporal.PlainDate.compare(candidate, to) < 0 ? candidate : to;
    chunks.push({ from: start, to: end });
    start = end.add({ days: 1 });
  }

  return chunks;
}

const seriesSchema = z.object({
  code: z.string().length(3),
  rates: z.array(z.object({ effectiveDate: z.string(), mid: z.number() })),
});

async function fetchChunk(
  code: Currency,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): Promise<readonly FxRate[]> {
  const url =
    `https://api.nbp.pl/api/exchangerates/rates/a/${code.toLowerCase()}` +
    `/${from.toString()}/${to.toString()}/?format=json`;

  const response = await fetch(url);

  // A range that contains no publication at all — a fortnight of holidays, or
  // a window before this currency joined table A — is a `404` carrying the
  // text "Not Found - Brak danych". That is an empty result, not a failure:
  // treating it as one would take down a chart because one of its chunks fell
  // on a quiet stretch.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`NBP responded with ${response.status}`);

  const series = seriesSchema.parse(await response.json());

  return series.rates.map((entry) => ({
    currency: currency(series.code),
    date: Temporal.PlainDate.from(entry.effectiveDate),
    mid: new Decimal(entry.mid),
  }));
}
