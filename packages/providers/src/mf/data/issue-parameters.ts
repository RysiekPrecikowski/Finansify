import { parseSeriesCode, type BondIssueParameters, type BondSeriesCode } from '@finansify/core';
import Decimal from 'decimal.js';

/**
 * Tier 2 of `docs/data-sources.md`: committed per-issue parameters for series
 * that are no longer the current month's offer.
 *
 * This exists because there is **no automated route to history at all** — the
 * emission-letter archive is a POST form behind PKO's WAF (ADR 0016). So this
 * file is load-bearing rather than a cold-start convenience, and it grows by
 * hand whenever someone enters a holding older than the current offer.
 *
 * Rates are fractions, matching the domain: 5.35% is `'0.0535'`. Both numbers
 * come from the issue's own emission letter or offer page — never from a
 * secondary source, and never inferred from a neighbouring month.
 *
 * **Adding an entry is a data change that gets reviewed like code.** A wrong
 * first-period rate is wrong for the whole life of the bond, and for EDO that
 * is ten years of silently incorrect valuation.
 */
const entries: Readonly<Record<string, { firstPeriodRate: string; margin: string }>> = {
  // Seeded with August 2026's offer, verified against each family's own page on
  // 2026-08-14. These are the current month at time of writing, so they are
  // also reachable live — they are here to give the resolver something real to
  // read before the first live fetch, and as the worked example of the format.
  OTS1126: { firstPeriodRate: '0.02', margin: '0' },
  ROR0827: { firstPeriodRate: '0.04', margin: '0' },
  DOR0828: { firstPeriodRate: '0.0415', margin: '0.0015' },
  TOS0829: { firstPeriodRate: '0.044', margin: '0' },
  COI0830: { firstPeriodRate: '0.0475', margin: '0.015' },
  ROS0832: { firstPeriodRate: '0.05', margin: '0.02' },
  EDO0836: { firstPeriodRate: '0.0535', margin: '0.02' },
  ROD0838: { firstPeriodRate: '0.056', margin: '0.025' },
};

export function bootstrapIssueParameters(code: BondSeriesCode): BondIssueParameters | null {
  const entry = entries[code];
  if (entry === undefined) return null;

  return {
    // Round-trip through the parser so a typo in a key cannot introduce a code
    // that `parseSeriesCode` would otherwise have rejected.
    seriesCode: parseSeriesCode(code).code,
    firstPeriodRate: new Decimal(entry.firstPeriodRate),
    margin: new Decimal(entry.margin),
  };
}

/** Exposed so a test can assert every committed key is a valid series code. */
export const bootstrapSeriesCodes = Object.keys(entries);
