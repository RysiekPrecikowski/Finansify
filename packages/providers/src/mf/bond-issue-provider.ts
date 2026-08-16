import {
  parseSeriesCode,
  type BondFamily,
  type BondIssueParameterProvider,
  type BondIssueParameters,
  type BondSeriesCode,
} from '@finansify/core';
import Decimal from 'decimal.js';

import { bootstrapIssueParameters } from './data/issue-parameters';

/**
 * Per-issue parameters — the first-period rate and the margin, the only two
 * numbers `bond_series_terms` stores.
 *
 * Two tiers, and **committed data is consulted first** — which is deliberate,
 * and the opposite of the order `docs/data-sources.md` states for the feeds
 * where tier 1 is a live value:
 *
 * 1. **Committed bootstrap data.** A series' published terms are fixed for its
 *    whole life, so a known series never needs a network call at all.
 * 2. The family's **current offer page**, one GET, which states both numbers in
 *    prose. This covers the month currently on sale, and anything the
 *    committed file has not caught up with.
 *
 * The consequence worth naming: a corrected offer page cannot override a
 * committed row. That is the right trade for a value that does not change —
 * and it is why a wrong committed entry has to be fixed in the file rather
 * than waited out. The cross-tier test asserts the two agree for every family.
 *
 * There is no tier-1 route to history and there will not be one: the emission-
 * letter archive and the interest tables are POST forms that PKO's WAF answers
 * with 403 for any non-interactive client, confirmed with a real headless
 * browser (ADR 0015). The third tier — a manual override in the UI — is the
 * permanent escape hatch rather than a temporary one.
 */
const BASE = 'https://www.obligacjeskarbowe.pl';

/** The offer URL is `/oferta-obligacji/<family slug>/<series>/`, lower-cased. */
const FAMILY_SLUG: Record<BondFamily, string> = {
  OTS: 'obligacje-3-miesieczne-ots',
  ROR: 'obligacje-roczne-ror',
  DOR: 'obligacje-2-letnie-dor',
  TOS: 'obligacje-3-letnie-tos',
  COI: 'obligacje-4-letnie-coi',
  ROS: 'obligacje-6-letnie-ros',
  EDO: 'obligacje-10-letnie-edo',
  ROD: 'obligacje-12-letnie-rod',
};

export function offerUrlFor(code: BondSeriesCode): string {
  const { family } = parseSeriesCode(code);
  return `${BASE}/oferta-obligacji/${FAMILY_SLUG[family]}/${code.toLowerCase()}/`;
}

/**
 * The page is marketing HTML, so it is flattened to text and read with two
 * narrow patterns rather than by walking the DOM. Both are anchored on the
 * Ministry's own fixed phrasing, and a page that no longer matches yields
 * `null` — which sends the caller to the next tier instead of to a guess.
 */
function flatten(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ');
  return withoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&oacute;/g, 'ó')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** "Oprocentowanie: 5,35% w pierwszym rocznym okresie odsetkowym" → 0.0535 */
const FIRST_PERIOD =
  /Oprocentowanie:\s*([\d,]+)\s*%[^.]*?w\s+pierwszym\s+(?:rocznym|miesięcznym)\s+okresie/i;
/** OTS and TOS state a single rate for the whole term instead. */
const WHOLE_TERM = /Oprocentowanie:\s*([\d,]+)\s*%?,?\s*(?:w skali roku,\s*)?stałe\s+przez\s+cały/i;
/** "marża 2,00% + inflacja" or "stopa referencyjna NBP+0,15%" */
const MARGIN = /(?:marża\s*([\d,]+)\s*%|stopa\s+referencyjna\s+NBP\s*\+\s*([\d,]+)\s*%)/i;

function percentToFraction(raw: string): Decimal {
  return new Decimal(raw.replace(',', '.')).dividedBy(100);
}

/**
 * A first-period rate outside 0–25% means the pattern matched the wrong number
 * on a redesigned page. Refuse rather than write it: a wrong first-period rate
 * is wrong for the entire life of the bond.
 */
const MAX_RATE = new Decimal('0.25');

export function parseOfferPage(code: BondSeriesCode, html: string): BondIssueParameters | null {
  const text = flatten(html);

  const rateMatch = FIRST_PERIOD.exec(text) ?? WHOLE_TERM.exec(text);
  if (rateMatch?.[1] === undefined) return null;

  let firstPeriodRate: Decimal;
  try {
    firstPeriodRate = percentToFraction(rateMatch[1]);
  } catch {
    return null;
  }
  if (!firstPeriodRate.isFinite() || firstPeriodRate.isNegative()) return null;
  if (firstPeriodRate.greaterThan(MAX_RATE)) return null;

  // A fixed family has no margin, and that is a fact about the family rather
  // than a parse failure — `families.ts` already knows which those are, so a
  // missing margin here is correctly zero rather than a reason to give up.
  const marginMatch = MARGIN.exec(text);
  const marginRaw = marginMatch?.[1] ?? marginMatch?.[2];
  let margin = new Decimal(0);
  if (marginRaw !== undefined) {
    try {
      margin = percentToFraction(marginRaw);
    } catch {
      return null;
    }
    if (!margin.isFinite() || margin.isNegative() || margin.greaterThan(MAX_RATE)) return null;
  }

  return { seriesCode: code, firstPeriodRate, margin };
}

export const mfBondIssueProvider: BondIssueParameterProvider = {
  name: 'mf',

  async fetchIssueParameters(code: BondSeriesCode): Promise<BondIssueParameters | null> {
    const bootstrapped = bootstrapIssueParameters(code);
    if (bootstrapped !== null) return bootstrapped;

    const response = await fetch(offerUrlFor(code));
    // A 404 is the ordinary answer for any series that is not the current
    // month's offer, so it is not an error — it is "try the next tier".
    if (!response.ok) return null;

    return parseOfferPage(code, await response.text());
  },
};
