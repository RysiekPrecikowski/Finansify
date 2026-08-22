import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  accountId,
  currency,
  instrumentId,
  Money,
  Temporal,
  type Account,
  type CashBalanceLine,
  type Instrument,
  type PriceLookup,
  type ValuedAccountLine,
  type ValuedPosition,
} from '@finansify/core';

import {
  buildAccountTotals,
  buildDashboardHoldings,
  buildTotals,
  filterByAssetClass,
  sortHoldings,
  type DashboardHolding,
  type DashboardHoldingValuation,
} from './snapshot';

// Deterministic, distinct, UUID-shaped ids: `uid('1')` reproduces the exact
// id `packages/core`'s own tests use ('11111111-1111-4111-8111-...'); any
// other single hex character gives a different but equally valid one.
function uid(hex: string): string {
  return `${hex.repeat(8)}-${hex.repeat(4)}-4${hex.repeat(3)}-8${hex.repeat(3)}-${hex.repeat(12)}`;
}

const PLN = currency('PLN');
const USD = currency('USD');

/** A year `publishedWrapperRules` actually has rows for, so the contribution bar isn't silently dropped in these fixtures. */
const LIMIT_YEAR = 2026;

const ASOF = Temporal.PlainDate.from('2026-08-13');
const FETCHED_AT = Temporal.Instant.from('2026-08-13T12:00:00Z');

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: accountId(uid('1')),
    name: 'Test account',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: PLN,
    openedAt: Temporal.PlainDate.from('2024-01-01'),
    closedAt: null,
    ...overrides,
  };
}

function makeInstrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: instrumentId(uid('2')),
    kind: 'equity',
    isin: null,
    symbol: 'AAPL',
    exchange: null,
    currency: USD,
    name: 'Apple Inc.',
    ...overrides,
  };
}

function makeValuedLine(overrides: Partial<ValuedAccountLine> = {}): ValuedAccountLine {
  const account = overrides.account ?? makeAccount();
  const costBasis = overrides.costBasis ?? Money.of('400', account.currency);
  return {
    account,
    quantity: new Decimal('10'),
    costBasis,
    averageCost: costBasis.amount.dividedBy('10'),
    realized: Money.zero(costBasis.currency),
    lots: [],
    marketValue: null,
    unrealized: null,
    ...overrides,
  };
}

function makeValuedPosition(overrides: Partial<ValuedPosition> = {}): ValuedPosition {
  const instrument = overrides.instrument ?? makeInstrument();
  const lines = overrides.lines ?? [];
  return {
    instrument,
    quantity: lines.reduce((total, line) => total.plus(line.quantity), new Decimal(0)),
    costBasisByCurrency: [],
    averageCost: null,
    realizedByCurrency: [],
    lines,
    marketValueByCurrency: [],
    unrealizedByCurrency: [],
    ...overrides,
  };
}

function makeCashLine(overrides: Partial<CashBalanceLine> = {}): CashBalanceLine {
  const account = overrides.account ?? makeAccount();
  return {
    account,
    amount: Money.zero(account.currency),
    ...overrides,
  };
}

function freshPrice(close: Money): PriceLookup {
  return { status: 'fresh', close, asOf: ASOF, fetchedAt: FETCHED_AT };
}

function makeValuation(
  overrides: Partial<DashboardHoldingValuation> = {},
): DashboardHoldingValuation {
  return {
    price: null,
    value: Money.zero(PLN),
    gain: null,
    gainRatio: null,
    ...overrides,
  };
}

function makeHolding(overrides: Partial<DashboardHolding> = {}): DashboardHolding {
  return {
    id: instrumentId(uid('9')),
    symbol: 'AAA',
    name: 'AAA Inc.',
    assetClass: 'equity',
    quantity: '10',
    averageCost: null,
    cost: null,
    valuation: null,
    ...overrides,
  };
}

describe('buildDashboardHoldings', () => {
  it('maps a fully priced position to a non-null valuation with price, value and gain', () => {
    const instrument = makeInstrument({ symbol: 'AAPL', kind: 'equity' });
    const quantity = new Decimal('7.25');
    const position = makeValuedPosition({
      instrument,
      quantity,
      costBasisByCurrency: [Money.of('400', PLN)],
      averageCost: new Decimal('40'),
      marketValueByCurrency: [Money.of('500', PLN)],
      unrealizedByCurrency: [Money.of('100', PLN)],
    });
    const priceLookups = new Map([[instrument.id, freshPrice(Money.of('50', USD))]]);

    const [holding] = buildDashboardHoldings([position], priceLookups);

    expect(holding!.valuation).not.toBeNull();
    expect(holding!.valuation!.price?.equals(Money.of('50', USD))).toBe(true);
    expect(holding!.valuation!.value.equals(Money.of('500', PLN))).toBe(true);
    expect(holding!.valuation!.gain?.equals(Money.of('100', PLN))).toBe(true);
    // gain / cost = 100 / 400 = 0.25, as a fixed 6-decimal string.
    expect(holding!.valuation!.gainRatio).toBe('0.250000');
    expect(holding!.cost?.equals(Money.of('400', PLN))).toBe(true);
    expect(holding!.averageCost?.equals(Money.of('40', PLN))).toBe(true);
    expect(holding!.quantity).toBe(quantity.toFixed());
    expect(holding!.assetClass).toBe('equity');
  });

  it('maps a position with no price at all to a null valuation, never a zero or estimate', () => {
    const position = makeValuedPosition({
      costBasisByCurrency: [Money.of('400', PLN)],
      averageCost: new Decimal('40'),
      marketValueByCurrency: [], // nothing has priced this instrument
      unrealizedByCurrency: [],
    });

    const [holding] = buildDashboardHoldings([position], new Map());

    expect(holding!.valuation).toBeNull();
  });

  it('nulls cost, averageCost and gainRatio when cost basis spans more than one currency', () => {
    const instrument = makeInstrument();
    const position = makeValuedPosition({
      instrument,
      // Two cost-basis currencies -> no single figure exists.
      costBasisByCurrency: [Money.of('400', PLN), Money.of('100', USD)],
      averageCost: null,
      marketValueByCurrency: [Money.of('900', PLN)],
      // Deliberately exactly one unrealized entry, to prove gainRatio still
      // nulls out on the cost-basis-currency condition alone.
      unrealizedByCurrency: [Money.of('50', PLN)],
    });

    const [holding] = buildDashboardHoldings([position], new Map());

    expect(holding!.cost).toBeNull();
    expect(holding!.averageCost).toBeNull();
    expect(holding!.valuation).not.toBeNull();
    expect(holding!.valuation!.gain?.equals(Money.of('50', PLN))).toBe(true);
    expect(holding!.valuation!.gainRatio).toBeNull();
  });

  it('takes assetClass from the instrument kind', () => {
    const position = makeValuedPosition({ instrument: makeInstrument({ kind: 'bond' }) });

    const [holding] = buildDashboardHoldings([position], new Map());

    expect(holding!.assetClass).toBe('bond');
  });
});

describe('buildTotals', () => {
  it('sums cost in a single, fully convertible currency and derives change/ratio from it', () => {
    const positionA = makeValuedPosition({ costBasisByCurrency: [Money.of('100', PLN)] });
    const positionB = makeValuedPosition({ costBasisByCurrency: [Money.of('50', PLN)] });
    const valuation = {
      positions: [],
      totalMarketValue: Money.of('660', PLN),
      totalIsComplete: true,
    };

    const totals = buildTotals([positionA, positionB], valuation, new Map(), PLN);

    expect(totals.totalCost.equals(Money.of('150', PLN))).toBe(true);
    expect(totals.totalValue.equals(valuation.totalMarketValue)).toBe(true);
    expect(totals.changeTotal.equals(Money.of('510', PLN))).toBe(true); // 660 - 150
    expect(totals.changeTotalRatio).toBe('3.400000'); // 510 / 150
    expect(totals.totalIsComplete).toBe(true);
  });

  it('excludes an unconvertible cost-basis leg and flips totalIsComplete false, without throwing', () => {
    const position = makeValuedPosition({
      costBasisByCurrency: [Money.of('100', PLN), Money.of('50', USD)],
    });
    const valuation = {
      positions: [],
      totalMarketValue: Money.of('200', PLN),
      totalIsComplete: true,
    };
    const ratesToPln = new Map(); // no USD rate on file

    const totals = buildTotals([position], valuation, ratesToPln, PLN);

    // The USD leg is dropped, not substituted with anything.
    expect(totals.totalCost.equals(Money.of('100', PLN))).toBe(true);
    expect(totals.totalIsComplete).toBe(false);
  });

  it('propagates valuation.totalIsComplete === false even when every cost leg converts fine', () => {
    const position = makeValuedPosition({ costBasisByCurrency: [Money.of('100', PLN)] });
    const valuation = {
      positions: [],
      totalMarketValue: Money.of('50', PLN),
      totalIsComplete: false,
    };

    const totals = buildTotals([position], valuation, new Map(), PLN);

    expect(totals.totalCost.equals(Money.of('100', PLN))).toBe(true);
    expect(totals.totalIsComplete).toBe(false);
  });
});

describe('buildAccountTotals', () => {
  it("sums each account's own lines and cash, converts to total, and zeroes an empty account", () => {
    const accountA = makeAccount({ id: accountId(uid('a')), name: 'A' });
    const accountB = makeAccount({ id: accountId(uid('b')), name: 'B' });
    const accountC = makeAccount({ id: accountId(uid('c')), name: 'C — holds nothing' });

    const lineA = makeValuedLine({
      account: accountA,
      quantity: new Decimal('5'),
      marketValue: Money.of('100', PLN),
    });
    const lineB = makeValuedLine({
      account: accountB,
      quantity: new Decimal('3'),
      marketValue: Money.of('50', PLN),
    });
    const position = makeValuedPosition({ lines: [lineA, lineB] });

    const cashA = makeCashLine({ account: accountA, amount: Money.of('20', PLN) });
    const cashB = makeCashLine({ account: accountB, amount: Money.of('10', PLN) });

    const result = buildAccountTotals(
      [accountA, accountB, accountC],
      [position],
      [cashA, cashB],
      new Map(),
      PLN,
      LIMIT_YEAR,
    );

    expect(result).toHaveLength(3);
    // Same order and length as the input accounts array.
    expect(result.map((account) => account.id)).toEqual([accountA.id, accountB.id, accountC.id]);

    expect(result[0]!.value?.equals(Money.of('120', PLN))).toBe(true); // 100 + 20
    expect(result[1]!.value?.equals(Money.of('60', PLN))).toBe(true); // 50 + 10
    // An account with zero matching lines/cash gets Money.zero, not null.
    expect(result[2]!.value).not.toBeNull();
    expect(result[2]!.value?.equals(Money.zero(PLN))).toBe(true);
  });

  it('marks an account null for a missing-priced open line, but not for a closed (zero-quantity) one', () => {
    const accountD = makeAccount({ id: accountId(uid('d')) });
    const accountE = makeAccount({ id: accountId(uid('e')) });

    const openLineNoPrice = makeValuedLine({
      account: accountD,
      quantity: new Decimal('5'), // still open
      marketValue: null,
    });
    const closedLineNoPrice = makeValuedLine({
      account: accountE,
      quantity: new Decimal('0'), // fully sold — contributes nothing either way
      marketValue: null,
    });
    const position = makeValuedPosition({ lines: [openLineNoPrice, closedLineNoPrice] });

    const result = buildAccountTotals(
      [accountD, accountE],
      [position],
      [],
      new Map(),
      PLN,
      LIMIT_YEAR,
    );

    expect(result[0]!.value).toBeNull();
    expect(result[1]!.value).not.toBeNull();
    expect(result[1]!.value?.equals(Money.zero(PLN))).toBe(true);
  });

  it('marks an account null when any of its amounts has no FX rate, rather than dropping just that leg', () => {
    const accountF = makeAccount({ id: accountId(uid('f')) });

    const convertibleLine = makeValuedLine({
      account: accountF,
      quantity: new Decimal('1'),
      marketValue: Money.of('100', PLN),
    });
    const position = makeValuedPosition({ lines: [convertibleLine] });
    const unconvertibleCash = makeCashLine({ account: accountF, amount: Money.of('50', USD) });

    const result = buildAccountTotals(
      [accountF],
      [position],
      [unconvertibleCash],
      new Map(), // no USD rate
      PLN,
      LIMIT_YEAR,
    );

    // Not 100 PLN (the convertible leg alone) — the whole account is null.
    expect(result[0]!.value).toBeNull();
  });
});

describe('filterByAssetClass', () => {
  it('returns the input unchanged when assetClass is null', () => {
    const holdings = [
      makeHolding({ symbol: 'A', assetClass: 'equity' }),
      makeHolding({ symbol: 'B', assetClass: 'etf' }),
    ];

    expect(filterByAssetClass(holdings, null)).toEqual(holdings);
  });

  it('returns only holdings matching the given asset class', () => {
    const equityA = makeHolding({ symbol: 'A', assetClass: 'equity' });
    const etf = makeHolding({ symbol: 'B', assetClass: 'etf' });
    const equityC = makeHolding({ symbol: 'C', assetClass: 'equity' });

    const result = filterByAssetClass([equityA, etf, equityC], 'equity');

    expect(result).toEqual([equityA, equityC]);
  });
});

describe('sortHoldings', () => {
  it('valueDesc orders by value descending; unvaluable holdings always sort last, alphabetically among themselves', () => {
    const a = makeHolding({
      symbol: 'A',
      valuation: makeValuation({ value: Money.of('100', PLN) }),
    });
    const b = makeHolding({
      symbol: 'B',
      valuation: makeValuation({ value: Money.of('300', PLN) }),
    });
    const c = makeHolding({
      symbol: 'C',
      valuation: makeValuation({ value: Money.of('200', PLN) }),
    });
    const zNull = makeHolding({ symbol: 'Z', valuation: null });
    const yNull = makeHolding({ symbol: 'Y', valuation: null });

    const sorted = sortHoldings([a, b, c, zNull, yNull], 'valueDesc');

    expect(sorted.map((h) => h.symbol)).toEqual(['B', 'C', 'A', 'Y', 'Z']);
  });

  it('gainAbsoluteDesc orders by gain descending; null-gain holdings sort after valued ones, unvaluable last of all', () => {
    const a = makeHolding({
      symbol: 'A',
      valuation: makeValuation({ value: Money.of('1', PLN), gain: Money.of('200', PLN) }),
    });
    const b = makeHolding({
      symbol: 'B',
      valuation: makeValuation({ value: Money.of('1', PLN), gain: Money.of('50', PLN) }),
    });
    // Multi-currency-cost-basis edge case: valuation present, gain null.
    const e = makeHolding({
      symbol: 'E',
      valuation: makeValuation({ value: Money.of('1', PLN), gain: null }),
    });
    const dNull = makeHolding({ symbol: 'D', valuation: null });

    const sorted = sortHoldings([a, b, e, dNull], 'gainAbsoluteDesc');

    expect(sorted.map((h) => h.symbol)).toEqual(['A', 'B', 'E', 'D']);
  });

  it('gainPercentDesc orders by gain percent descending; null-gain or null-cost holdings sort after valued ones', () => {
    const a = makeHolding({
      symbol: 'A',
      cost: Money.of('200', PLN),
      valuation: makeValuation({ value: Money.of('1', PLN), gain: Money.of('100', PLN) }), // 50%
    });
    const b = makeHolding({
      symbol: 'B',
      cost: Money.of('200', PLN),
      valuation: makeValuation({ value: Money.of('1', PLN), gain: Money.of('50', PLN) }), // 25%
    });
    // gain present, cost null (multi-currency cost basis).
    const f = makeHolding({
      symbol: 'F',
      cost: null,
      valuation: makeValuation({ value: Money.of('1', PLN), gain: Money.of('999', PLN) }),
    });
    // gain null, cost present.
    const g = makeHolding({
      symbol: 'G',
      cost: Money.of('10', PLN),
      valuation: makeValuation({ value: Money.of('1', PLN), gain: null }),
    });
    const dNull = makeHolding({ symbol: 'D', valuation: null });

    const sorted = sortHoldings([a, b, f, g, dNull], 'gainPercentDesc');

    expect(sorted.map((h) => h.symbol)).toEqual(['A', 'B', 'F', 'G', 'D']);
  });

  it('nameAsc orders alphabetically by symbol; unvaluable holdings still sort last regardless of their letter', () => {
    const charlie = makeHolding({ symbol: 'Charlie', valuation: makeValuation() });
    const alpha = makeHolding({ symbol: 'Alpha', valuation: makeValuation() });
    const bravo = makeHolding({ symbol: 'Bravo', valuation: makeValuation() });
    // Alphabetically first, but unvaluable — must still land after every valued holding.
    const aaaNull = makeHolding({ symbol: 'AAA_null', valuation: null });
    const zzzNull = makeHolding({ symbol: 'ZZZ_null', valuation: null });

    const sorted = sortHoldings([charlie, alpha, bravo, zzzNull, aaaNull], 'nameAsc');

    expect(sorted.map((h) => h.symbol)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'AAA_null',
      'ZZZ_null',
    ]);
  });

  it('gainPercentDesc cross-multiplies rather than dividing, so precision beyond a double survives', () => {
    // Two fractions that differ only past the ~17 significant digits a JS
    // `Number` can hold: 1/3 exactly, versus a hair above it. A comparison
    // that went through `Number(gain)/Number(cost)` would collapse both to
    // the same double (0.3333333333333333) and could not tell them apart;
    // exact `Decimal` cross-multiplication can.
    const barelyAboveThird = makeHolding({
      symbol: 'BigA',
      cost: Money.of('300000000000000000', PLN),
      valuation: makeValuation({
        value: Money.of('1', PLN),
        gain: Money.of('100000000000000001', PLN),
      }),
    });
    const exactlyThird = makeHolding({
      symbol: 'BigB',
      cost: Money.of('3', PLN),
      valuation: makeValuation({ value: Money.of('1', PLN), gain: Money.of('1', PLN) }),
    });

    const sorted = sortHoldings([exactlyThird, barelyAboveThird], 'gainPercentDesc');

    expect(sorted.map((h) => h.symbol)).toEqual(['BigA', 'BigB']);
  });
});
