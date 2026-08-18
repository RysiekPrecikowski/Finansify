import {
  FractionalBondError,
  interestTableKeyFor,
  makeRefreshIndexSeries,
  parseSeriesCode,
  valueBondPosition,
  type BondInterestTable,
  type BondSeriesCode,
  type InstrumentId,
  type InstrumentPosition,
  type PriceLookup,
  type PublishedTables,
  type PurchaseDayKey,
} from '@finansify/core';

import {
  clock,
  getBondInterestTables,
  getBondTermsResolver,
  getCpiProvider,
  getIndexObservations,
  getInterestTableProvider,
  getReferenceRateProvider,
} from '@/server/container';

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
/**
 * The published tables for one series, as far as they are already stored.
 *
 * No network, by design. The stored rows are tried first and the fetch below
 * only runs when they turn out not to cover the holding — so a series whose
 * tables are on hand costs nothing per render, which is the whole point of
 * caching them.
 */
async function storedTablesFor(
  code: BondSeriesCode,
  dayKeys: ReadonlySet<PurchaseDayKey>,
): Promise<PublishedTables> {
  const byDayKey = new Map<PurchaseDayKey, ReadonlyMap<number, BondInterestTable>>();

  try {
    const repository = getBondInterestTables();
    for (const dayKey of dayKeys) byDayKey.set(dayKey, await repository.find(code, dayKey));
  } catch (error) {
    // Reported and degraded, never thrown. This is the cache, not the ledger:
    // a table we cannot read is the same situation as one nobody published,
    // and the engine answers either way. Letting it escape instead cost the
    // position its value entirely — found by running the app against a
    // database the migration had not reached, where every bond rendered as
    // "price loading" rather than as an accrued figure.
    console.error(`Could not read stored interest tables for ${code}`, error);
    return () => new Map();
  }

  return (dayKey) => byDayKey.get(dayKey) ?? new Map();
}

/**
 * Fetch whatever the emission agent publishes for this series that we do not
 * already hold, store it, and hand back the enlarged set — ADR 0011's
 * cache-on-first-use rule applied to a second kind of bond reference data.
 *
 * Called only after the stored tables have failed to value the position, which
 * makes it lazy in the strict sense: nothing is fetched for a series nobody
 * holds, and nothing is fetched twice. That a stored table never needs
 * refreshing is a property of the source rather than an assumption — an agent
 * publishes a period's *whole* daily grid as soon as its rate is known, so a
 * row on hand is final and only a holding rolling into a new period comes back
 * here.
 *
 * The residual cost is a series the agent publishes nothing for — OTS, ROS and
 * ROD, and any period not yet published — which asks once per render and
 * learns nothing. That is one GET for a holding that is valued by the engine
 * anyway; worth removing if the family list ever grows, not worth a negative
 * cache today.
 *
 * A failed fetch is not an error. Three of the eight families publish no tables
 * at all, and a down agent is the same situation as an unpublished one: the
 * caller values the holding with the engine instead, which is a correct answer
 * rather than an outage.
 */
async function refreshTablesFor(
  code: BondSeriesCode,
  dayKeys: ReadonlySet<PurchaseDayKey>,
  stored: PublishedTables,
): Promise<PublishedTables> {
  const repository = getBondInterestTables();
  const provider = getInterestTableProvider();

  try {
    const publishedKeys = await provider.fetchPublishedTables(code);
    const missing = publishedKeys.filter(
      (key) =>
        dayKeys.has(key.purchaseDayKey) && !stored(key.purchaseDayKey).has(key.periodOrdinal),
    );
    if (missing.length === 0) return stored;

    // Serially, not `Promise.all`. A twelve-year family has twelve periods to
    // collect on first use, and firing all of them at an emission agent at
    // once is the kind of burst that earns a 429 for everyone afterwards.
    // This runs once per series in its lifetime; the latency is not worth the
    // rudeness.
    const usable: BondInterestTable[] = [];
    for (const key of missing) {
      const table = await provider.fetchTable(code, key);
      if (table !== null) usable.push(table);
    }
    if (usable.length === 0) return stored;

    await repository.save(usable);
    return await storedTablesFor(code, dayKeys);
  } catch (error) {
    console.error(`Could not refresh published interest tables for ${code}`, error);
    return stored;
  }
}

export async function bondPriceLookups(
  positions: readonly InstrumentPosition[],
): Promise<ReadonlyMap<InstrumentId, PriceLookup>> {
  const bonds = positions.filter((position) => position.instrument.kind === 'bond');
  const lookups = new Map<InstrumentId, PriceLookup>();
  if (bonds.length === 0) return lookups;

  const asOf = clock.now().toZonedDateTimeISO(displayTimeZone).toPlainDate();
  const resolver = getBondTermsResolver();
  const repository = getIndexObservations();

  // Refresh before reading. `/portfolio` is the screen a user with bonds
  // actually opens, and until this was here it only ever *read* the macro
  // series — someone who never visited `/indicators` or the dashboard would
  // have their bonds valued against whatever was last fetched, silently, for
  // as long as that lasted. `isIndexSeriesDue` keeps the cost near zero: CPI
  // asks again only once the calendar month has moved past the newest print,
  // and the reference rate only after a week.
  const refresh = makeRefreshIndexSeries({
    repository,
    providers: [getReferenceRateProvider(), getCpiProvider()],
    today: () => asOf,
  });
  // Failures are reported, not thrown, so a down GUS degrades to valuing on
  // the last known print rather than taking `/portfolio` with it.
  await Promise.all([refresh('nbp_reference'), refresh('pl_cpi_yoy')]);

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

      const holdings = valuedLots.map((entry) => ({ terms: entry.terms!, lot: entry.lot }));
      const dayKeys = new Set(lots.map((lot) => interestTableKeyFor(lot.openedOn)));

      // Stored table, then a live fetch, then the engine — and the decision of
      // whether the stored tables suffice is `valueBondPosition`'s, not a
      // second copy of the period arithmetic here. A position that comes back
      // `'computed'` had at least one lot the published tables could not
      // answer for, which is exactly when it is worth asking the agent.
      const stored = await storedTablesFor(code, dayKeys);
      let valued = valueBondPosition(holdings, asOf, observations, stored);
      if (valued.source === 'computed') {
        const refreshed = await refreshTablesFor(code, dayKeys, stored);
        if (refreshed !== stored) {
          valued = valueBondPosition(holdings, asOf, observations, refreshed);
        }
      }
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
