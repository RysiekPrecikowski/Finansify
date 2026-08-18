import { describe, expect, it } from 'vitest';

import {
  chartSource,
  defaultFxSourcePreference,
  valuationDivergesFromTax,
  valuationSource,
  type FxSourcePreference,
} from './fx-source';

const preference = (source: 'nbp' | 'yahoo', scope: 'charts' | 'all'): FxSourcePreference => ({
  source,
  scope,
});

describe('valuationSource', () => {
  it('defaults to the only combination where valuation and tax agree', () => {
    expect(defaultFxSourcePreference).toEqual({ source: 'nbp', scope: 'charts' });
    expect(valuationSource(defaultFxSourcePreference)).toBe('nbp');
  });

  it('leaves valuation on NBP when the choice is scoped to charts', () => {
    expect(valuationSource(preference('yahoo', 'charts'))).toBe('nbp');
  });

  it('moves valuation onto the chosen source only when the scope says everything', () => {
    expect(valuationSource(preference('yahoo', 'all'))).toBe('yahoo');
  });

  it('is NBP under scope `all` when NBP is what was chosen', () => {
    expect(valuationSource(preference('nbp', 'all'))).toBe('nbp');
  });
});

describe('chartSource', () => {
  it('always follows the choice, whatever the scope — that is what the choice is for', () => {
    expect(chartSource(preference('yahoo', 'charts'))).toBe('yahoo');
    expect(chartSource(preference('yahoo', 'all'))).toBe('yahoo');
    expect(chartSource(preference('nbp', 'all'))).toBe('nbp');
  });
});

describe('valuationDivergesFromTax', () => {
  it('is false whenever the valuation still reads NBP', () => {
    expect(valuationDivergesFromTax(preference('nbp', 'all'))).toBe(false);
    // Looking at a market chart changes nothing about the book.
    expect(valuationDivergesFromTax(preference('yahoo', 'charts'))).toBe(false);
  });

  it('is true once a market rate values the portfolio, because tax will not use it', () => {
    expect(valuationDivergesFromTax(preference('yahoo', 'all'))).toBe(true);
  });
});
