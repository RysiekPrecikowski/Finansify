import { parseSeriesCode, type BondSeriesCode } from '@finansify/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { offerUrlFor, parseOfferPage } from './bond-issue-provider';
import { bootstrapIssueParameters, bootstrapSeriesCodes } from './data/issue-parameters';

/** Real offer pages, trimmed to the summary block, saved on 2026-08-14. */
const page = (code: string) =>
  readFileSync(join(import.meta.dirname, '__fixtures__', `${code.toLowerCase()}.html`), 'utf-8');

const code = (value: string): BondSeriesCode => parseSeriesCode(value).code;

describe('offerUrlFor', () => {
  it('builds the family slug the site actually uses', () => {
    expect(offerUrlFor(code('EDO0836'))).toBe(
      'https://www.obligacjeskarbowe.pl/oferta-obligacji/obligacje-10-letnie-edo/edo0836/',
    );
    expect(offerUrlFor(code('OTS1126'))).toBe(
      'https://www.obligacjeskarbowe.pl/oferta-obligacji/obligacje-3-miesieczne-ots/ots1126/',
    );
  });
});

describe('parseOfferPage', () => {
  // Every expectation below is the figure printed on that family's own page.
  it.each([
    ['EDO0836', '0.0535', '0.0200'],
    ['ROD0838', '0.0560', '0.0250'],
    ['ROS0832', '0.0500', '0.0200'],
    ['COI0830', '0.0475', '0.0150'],
    ['DOR0828', '0.0415', '0.0015'],
    ['ROR0827', '0.0400', '0.0000'],
    ['TOS0829', '0.0440', '0.0000'],
    ['OTS1126', '0.0200', '0.0000'],
  ])('reads %s as %s first-period and %s margin', (series, rate, margin) => {
    const parsed = parseOfferPage(code(series), page(series));

    expect(parsed, `${series} did not parse`).not.toBeNull();
    expect(parsed?.firstPeriodRate.toFixed(4)).toBe(rate);
    expect(parsed?.margin.toFixed(4)).toBe(margin);
  });

  it('reads the reference-rate margin for DOR, not a literal "NBP"', () => {
    // DOR's page says "stopa referencyjna NBP+0,15%" rather than "marża".
    expect(parseOfferPage(code('DOR0828'), page('DOR0828'))?.margin.toFixed(4)).toBe('0.0015');
  });

  it('gives the fixed families a zero margin rather than failing to parse', () => {
    for (const series of ['OTS1126', 'TOS0829']) {
      expect(parseOfferPage(code(series), page(series))?.margin.isZero()).toBe(true);
    }
  });

  it('returns null on a page it no longer recognizes, rather than guessing', () => {
    expect(
      parseOfferPage(code('EDO0836'), '<html><body>Przerwa techniczna</body></html>'),
    ).toBeNull();
  });

  it('refuses an implausible rate rather than writing it', () => {
    // A redesigned page could put some other percentage where the rate was.
    const bogus = '<p>Oprocentowanie: 98,00% w pierwszym rocznym okresie odsetkowym</p>';
    expect(parseOfferPage(code('EDO0836'), bogus)).toBeNull();
  });
});

describe('the committed bootstrap data', () => {
  it('only holds keys that are valid series codes', () => {
    for (const series of bootstrapSeriesCodes) {
      expect(() => parseSeriesCode(series)).not.toThrow();
    }
  });

  it('returns null for a series it does not carry', () => {
    expect(bootstrapIssueParameters(code('EDO0125'))).toBeNull();
  });

  it('agrees exactly with the offer pages it was seeded from', () => {
    // The bootstrap file and the live parser must not drift: if they disagree,
    // a holding is valued differently depending on which tier answered.
    for (const series of bootstrapSeriesCodes) {
      const committed = bootstrapIssueParameters(code(series));
      const scraped = parseOfferPage(code(series), page(series));

      expect(committed, series).not.toBeNull();
      expect(scraped, series).not.toBeNull();
      expect(committed?.firstPeriodRate.toFixed(6), series).toBe(
        scraped?.firstPeriodRate.toFixed(6),
      );
      expect(committed?.margin.toFixed(6), series).toBe(scraped?.margin.toFixed(6));
    }
  });
});
