import { describe, expect, it } from 'vitest';

import { normalizeXtbTicker } from './ticker-suffix';

describe('normalizeXtbTicker — known listing-country suffixes', () => {
  it('maps .PL to .WA (Warsaw)', () => {
    expect(normalizeXtbTicker('XTB.PL')).toBe('XTB.WA');
  });

  it('maps .UK to .L (London)', () => {
    expect(normalizeXtbTicker('VWRD.UK')).toBe('VWRD.L');
  });

  it('maps .NL to .AS (Amsterdam)', () => {
    expect(normalizeXtbTicker('VWRL.NL')).toBe('VWRL.AS');
  });

  it('drops .US entirely', () => {
    expect(normalizeXtbTicker('ADC.US')).toBe('ADC');
  });

  it('leaves .DE unchanged (Xetra already agrees with XTB)', () => {
    expect(normalizeXtbTicker('SXR8.DE')).toBe('SXR8.DE');
  });
});

describe('normalizeXtbTicker — suffix matching is case-insensitive', () => {
  it('normalizes a lowercase known suffix the same as uppercase', () => {
    expect(normalizeXtbTicker('XTB.pl')).toBe('XTB.WA');
  });

  it('normalizes a mixed-case known suffix the same as uppercase', () => {
    expect(normalizeXtbTicker('VWRD.Uk')).toBe('VWRD.L');
  });

  it('drops a lowercase .us suffix the same as uppercase .US', () => {
    expect(normalizeXtbTicker('ADC.us')).toBe('ADC');
  });

  it('preserves the base ticker’s own casing — only the suffix is case-normalized', () => {
    expect(normalizeXtbTicker('xtb.pl')).toBe('xtb.WA');
  });
});

describe('normalizeXtbTicker — never guesses outside the confirmed mapping', () => {
  it('returns an unknown suffix unchanged, verbatim', () => {
    expect(normalizeXtbTicker('AAA.FR')).toBe('AAA.FR');
  });

  it('does not alter the casing of an unknown suffix (returns the original string, not a reconstruction)', () => {
    expect(normalizeXtbTicker('AAA.fr')).toBe('AAA.fr');
  });

  it('returns a ticker with no dot at all unchanged', () => {
    expect(normalizeXtbTicker('VUAA')).toBe('VUAA');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeXtbTicker('')).toBe('');
  });
});

describe('normalizeXtbTicker — edge cases in the dot/suffix split', () => {
  it('uses the last dot when a ticker has multiple dots, so a dotted base survives suffix stripping', () => {
    // e.g. a US-style dual-class ticker exported with XTB's own .US suffix
    // appended after it — the base "BRK.B" must survive, only the trailing
    // .US is XTB's own addition.
    expect(normalizeXtbTicker('BRK.B.US')).toBe('BRK.B');
  });

  it('uses the last dot for a known non-dropped suffix too', () => {
    expect(normalizeXtbTicker('BRK.B.PL')).toBe('BRK.B.WA');
  });

  it('treats a ticker that is only ".<suffix>" as an empty base', () => {
    expect(normalizeXtbTicker('.PL')).toBe('.WA');
  });

  it('treats a ".US" ticker as normalizing to an empty string', () => {
    expect(normalizeXtbTicker('.US')).toBe('');
  });

  it('returns a ticker unchanged when the text after the last dot is empty', () => {
    expect(normalizeXtbTicker('XTB.')).toBe('XTB.');
  });
});
