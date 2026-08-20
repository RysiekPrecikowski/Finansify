import { currency } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { parseBuyDetail, parseDividendTicker } from './detail-grammar';

describe('parseBuyDetail', () => {
  it('parses the real grammar: <name> (<ISIN>) <qty> x <price> <currency> nr <reference>', () => {
    const parsed = parseBuyDetail(
      'Vanguard FTSE All-World UCITS ETF (IE00B3RBWM25) 10 x 100.00 EUR nr Z00000000001',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('Vanguard FTSE All-World UCITS ETF');
    expect(parsed?.isin).toBe('IE00B3RBWM25');
    expect(parsed?.quantity.toString()).toBe('10');
    expect(parsed?.price.toString()).toBe('100');
    expect(parsed?.priceCurrency).toBe(currency('EUR'));
    expect(parsed?.reference).toBe('Z00000000001');
  });

  it('parses a short-code name the same way as a full fund name', () => {
    const parsed = parseBuyDetail('ETFSP500 (IE00B3RBWM25) 5 x 100.00 EUR nr Z00000000002');

    expect(parsed?.name).toBe('ETFSP500');
  });

  it('parses a dot-decimal price, not comma-decimal', () => {
    const parsed = parseBuyDetail('Fund (IE00B3RBWM25) 5 x 100.35 EUR nr Z1');

    expect(parsed?.price.toString()).toBe('100.35');
  });

  it('parses a decimal (fractional) quantity', () => {
    const parsed = parseBuyDetail('Fund (IE00B3RBWM25) 5.5 x 100.00 EUR nr Z1');

    expect(parsed?.quantity.toString()).toBe('5.5');
  });

  it('returns null for a string that does not match the grammar at all', () => {
    expect(parseBuyDetail('coś nietypowego, nie pasuje do wzorca')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseBuyDetail('')).toBeNull();
  });

  it('returns null when the ISIN is missing its parentheses', () => {
    expect(parseBuyDetail('Fund IE00B3RBWM25 5 x 100.00 EUR nr Z1')).toBeNull();
  });

  it('returns null when the ISIN checksum digit / shape is wrong (not two letters + 9 alnum + 1 digit)', () => {
    expect(parseBuyDetail('Fund (IE00B3RBWM2) 5 x 100.00 EUR nr Z1')).toBeNull();
  });

  it('returns null when the currency is not a three-letter code', () => {
    expect(parseBuyDetail('Fund (IE00B3RBWM25) 5 x 100.00 EURO nr Z1')).toBeNull();
  });

  it('returns null when the reference ("nr ...") is missing', () => {
    expect(parseBuyDetail('Fund (IE00B3RBWM25) 5 x 100.00 EUR')).toBeNull();
  });

  it('returns null for trailing text after an otherwise valid match (grammar is anchored)', () => {
    expect(parseBuyDetail('Fund (IE00B3RBWM25) 5 x 100.00 EUR nr Z1 extra')).toBeNull();
  });
});

describe('parseDividendTicker', () => {
  it('returns the ticker as-is when there is no trailing currency qualifier', () => {
    expect(parseDividendTicker('Wypłata dywidendy brutto ETFSP500')).toBe('ETFSP500');
  });

  it('strips a trailing currency-code qualifier, returning only the ticker', () => {
    expect(parseDividendTicker('Wypłata dywidendy brutto VWRL EUR')).toBe('VWRL');
  });

  it('strips the qualifier regardless of the currency it names (not tied to the row currency)', () => {
    expect(parseDividendTicker('Wypłata dywidendy brutto VGWL USD')).toBe('VGWL');
  });

  it('returns null for a title that does not start with the expected prefix', () => {
    expect(parseDividendTicker('Przelew do DM BOŚ')).toBeNull();
  });

  it('returns null for the prefix alone with nothing after it', () => {
    expect(parseDividendTicker('Wypłata dywidendy brutto ')).toBeNull();
  });

  it('returns null for the prefix followed only by whitespace', () => {
    expect(parseDividendTicker('Wypłata dywidendy brutto    ')).toBeNull();
  });

  it('is case-sensitive about the prefix', () => {
    expect(parseDividendTicker('wypłata dywidendy brutto ETFSP500')).toBeNull();
  });
});
