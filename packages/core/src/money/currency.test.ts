import { describe, expect, it } from 'vitest';
import { currency, currencySchema } from './currency';

describe('currency', () => {
  it('accepts a 3-letter uppercase code', () => {
    expect(currency('PLN')).toBe('PLN');
  });

  it('normalizes lowercase input', () => {
    expect(currency('pln')).toBe('PLN');
  });

  it('rejects codes that are not 3 letters', () => {
    expect(() => currency('PL')).toThrow();
    expect(() => currency('POLISH')).toThrow();
  });

  it('rejects non-letter characters', () => {
    expect(() => currency('PL1')).toThrow();
  });

  it('exposes the schema for use at import/parse boundaries', () => {
    expect(currencySchema.safeParse('USD').success).toBe(true);
    expect(currencySchema.safeParse('usd').success).toBe(false);
  });
});
