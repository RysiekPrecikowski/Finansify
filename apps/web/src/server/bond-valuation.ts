import {
  currency as toCurrency,
  parseSeriesCode,
  Temporal,
  valueBondPosition,
  type InstrumentId,
  type InstrumentPosition,
  type PriceLookup,
} from '@finansify/core';

import { clock, getBondTermsResolver, getIndexObservations } from '@/server/container';

const PLN = toCurrency('PLN');
const displayTimeZone = 'Europe/Warsaw';

/**
 * Bond holdings, expressed as `PriceLookup`s so they flow through the same
 * `valuePositions` pipeline as everything else.
 *
 * A retail bond has no market price, so this synthesizes one: the position's
 * accrued value **per bond**. That is not a quote and is not pretending to be —
 * it is the mechanism by which a bond gets a market value, an unrealized P&L
 * and a share of the PLN total without `/portfolio` growing a parallel table
 * and a second set of totals for one asset class.
 *
 * The division is exact rather than rounded: `Money` runs at 40 significant
 * digits, so `valuePositions` multiplying the unit value back by the quantity
 * returns the accrual's own total to the grosz. Rounding here would drift.
 */
export async function bondPriceLookups(
  positions: readonly InstrumentPosition[],
): Promise<ReadonlyMap<InstrumentId, PriceLookup>> {
  const bonds = positions.filter((position) => position.instrument.kind === 'bond');
  const lookups = new Map<InstrumentId, PriceLookup>();
  if (bonds.length === 0) return lookups;

  const asOf = clock.now().toZonedDateTimeISO(displayTimeZone).toPlainDate();
  const resolver = getBondTermsResolver();
  const repository = getIndexObservations();

  // Both series, once, rather than per position: the accrual engine needs the
  // whole history to rebuild past periods, and two holdings of the same family
  // would otherwise re-read it.
  const [referenceRates, cpi] = await Promise.all([
    repository.history('nbp_reference'),
    repository.history('pl_cpi_yoy'),
  ]);
  const observations = [...referenceRates, ...cpi];

  for (const position of bonds) {
    const lots = position.lines.flatMap((line) => line.lots);
    const openedFirst = lots
      .map((lot) => lot.openedOn)
      .sort((a, b) => Temporal.PlainDate.compare(a, b))[0];
    if (openedFirst === undefined || !position.quantity.greaterThan(0)) continue;

    try {
      // Terms are resolved against the earliest purchase, because that is the
      // one whose family rules could differ from today's — the fee revision is
      // dated by purchase. Lots bought later share the series' own published
      // rate and margin, which do not change over its life.
      const code = parseSeriesCode(position.instrument.symbol).code;
      const terms = await resolver.resolve(code, openedFirst);
      if (terms === null) {
        lookups.set(position.instrument.id, { status: 'unavailable', reason: 'unmapped' });
        continue;
      }

      const valued = valueBondPosition(terms, lots, asOf, observations);
      lookups.set(position.instrument.id, {
        status: 'fresh',
        close: valued.marketValue.dividedBy(position.quantity),
        asOf,
        fetchedAt: clock.now(),
      });
    } catch (error) {
      // A series we cannot value must show as unvaluable, never as zero and
      // never dropped from the total (`docs/data-sources.md`). Most likely
      // causes: a CPI print the engine needs has not been fetched, or the
      // holding is fractional.
      console.error(`Could not value bond ${position.instrument.symbol}`, error);
      lookups.set(position.instrument.id, { status: 'unavailable', reason: 'never-fetched' });
    }
  }

  return lookups;
}

export { PLN };
