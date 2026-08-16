import {
  FractionalBondError,
  parseSeriesCode,
  valueBondPosition,
  type InstrumentId,
  type InstrumentPosition,
  type PriceLookup,
} from '@finansify/core';

import { clock, getBondTermsResolver, getIndexObservations } from '@/server/container';

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
    if (lots.length === 0 || !position.quantity.greaterThan(0)) continue;

    try {
      const code = parseSeriesCode(position.instrument.symbol).code;

      // **Per lot, not per position.** `resolveFamilyRules` is effective-dated
      // by *purchase* date — the early-redemption fee moved on 2024-09-01 — so
      // a holding with lots either side of that date genuinely has two
      // different fees. Resolving once against the earliest lot applied the
      // older fee to all of them. The resolver caches, so every lot after the
      // first is a map lookup.
      const valuedLots = await Promise.all(
        lots.map(async (lot) => ({ lot, terms: await resolver.resolve(code, lot.openedOn) })),
      );
      if (valuedLots.some((entry) => entry.terms === null)) {
        lookups.set(position.instrument.id, { status: 'unavailable', reason: 'unmapped' });
        continue;
      }

      const valued = valueBondPosition(
        valuedLots.map((entry) => ({ terms: entry.terms!, lot: entry.lot })),
        asOf,
        observations,
      );
      lookups.set(position.instrument.id, {
        status: 'fresh',
        close: valued.marketValue.dividedBy(position.quantity),
        asOf,
        fetchedAt: clock.now(),
      });
    } catch (error) {
      // A series we cannot value must show as unvaluable, never as zero and
      // never dropped from the total (`docs/data-sources.md`).
      console.error(`Could not value bond ${position.instrument.symbol}`, error);

      // A fractional holding is not a missing fetch and must not claim to be:
      // "no price has arrived yet" tells the user the opposite of "your
      // quantity is 2.5, and retail bonds are indivisible". `unmapped` is the
      // closer of the two available reasons — the position needs a human, not
      // a retry — until `PriceLookup` grows a reason of its own.
      const reason = error instanceof FractionalBondError ? 'unmapped' : 'never-fetched';
      lookups.set(position.instrument.id, { status: 'unavailable', reason });
    }
  }

  return lookups;
}
