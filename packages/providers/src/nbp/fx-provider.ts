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
};
