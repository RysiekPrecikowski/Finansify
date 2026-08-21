import { type Money } from '@finansify/core';

import { type DashboardHolding } from './snapshot';

/**
 * Two fields the real read model cannot supply yet: a per-holding daily move
 * and a sector. Neither exists anywhere in `packages/core` — there is no
 * intraday price history (only end-of-day closes, `docs/data-sources.md`) and
 * no sector taxonomy on `Instrument` (`packages/core/src/ledger/types.ts`).
 * Both are real future work (an intraday feed, a sector classification), not
 * something the dashboard redesign should invent inside `core` (rule 2).
 *
 * This module is exactly what `packages/core` is not allowed to be: plain
 * presentational demo data, layered on top of the real, priced holdings the
 * page already computed. Every value here is **deterministic per symbol**
 * (a string hash, never `Math.random()`), so a reload — or a server render
 * followed by a client one — never disagrees with itself and never produces a
 * hydration mismatch.
 */

const sectorKeys = [
  'technology',
  'financials',
  'healthcare',
  'industrials',
  'consumer',
  'energy',
] as const;

/** `diversified` covers ETFs and funds (no single sector applies); `bonds` covers both bond kinds. */
export const demoSectorKeys = [...sectorKeys, 'diversified', 'bonds'] as const;
export type DemoSectorKey = (typeof demoSectorKeys)[number];

/** A small, stable string hash (djb2-ish) — not cryptographic, just deterministic. */
function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** Which demo sector a holding falls into. Stable for a given symbol and asset class. */
export function demoSectorFor(
  holding: Pick<DashboardHolding, 'symbol' | 'assetClass'>,
): DemoSectorKey {
  if (holding.assetClass === 'etf' || holding.assetClass === 'fund') return 'diversified';
  if (holding.assetClass === 'bond' || holding.assetClass === 'catalyst_bond') return 'bonds';
  return sectorKeys[hashString(holding.symbol) % sectorKeys.length]!;
}

/** A plausible daily move, roughly ±4%, seeded by symbol — a ratio string like `formatRatioAsPercent` expects. */
export function demoDayChangeRatio(symbol: string): string {
  const seed = hashString(`${symbol}:day`);
  const basisPoints = (seed % 801) - 400; // -400 .. +400 basis points
  return (basisPoints / 10000).toFixed(6);
}

export interface TopMover {
  readonly holding: DashboardHolding;
  readonly dayChangeRatio: string;
}

/** The `count` holdings with the largest simulated daily move, biggest first. Unvaluable positions have nothing to rank, so they're excluded. */
export function getTopMovers(
  holdings: readonly DashboardHolding[],
  count = 5,
): readonly TopMover[] {
  return holdings
    .filter((holding) => holding.valuation !== null)
    .map((holding) => ({ holding, dayChangeRatio: demoDayChangeRatio(holding.symbol) }))
    .sort((a, b) => Math.abs(Number(b.dayChangeRatio)) - Math.abs(Number(a.dayChangeRatio)))
    .slice(0, count);
}

export interface SectorSlice {
  readonly sector: DemoSectorKey;
  readonly value: Money;
  /** Share of `total`, `'0'` when `total` is zero. */
  readonly ratio: string;
}

/**
 * Holdings' market value grouped into the demo sectors, largest slice first.
 * `total` is the same presentation-currency total the rest of the dashboard
 * sums to, so every slice's `value` is already in that currency (rule 7 note
 * in `lib/dashboard/snapshot.ts` — the dashboard's holdings are single-Money,
 * never split across currencies).
 */
export function getSectorBreakdown(
  holdings: readonly DashboardHolding[],
  total: Money,
): readonly SectorSlice[] {
  const sums = new Map<DemoSectorKey, Money>();

  for (const holding of holdings) {
    if (holding.valuation === null) continue;
    const sector = demoSectorFor(holding);
    const running = sums.get(sector);
    sums.set(
      sector,
      running === undefined ? holding.valuation.value : running.plus(holding.valuation.value),
    );
  }

  return [...sums.entries()]
    .map(([sector, value]) => ({
      sector,
      value,
      ratio: total.isZero() ? '0' : value.amount.dividedBy(total.amount).toFixed(6),
    }))
    .sort((a, b) => Number(b.ratio) - Number(a.ratio));
}
