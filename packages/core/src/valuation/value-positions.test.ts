import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { accountId, instrumentId, type Account, type Instrument } from '../ledger/types';
import { currency, Money } from '../money';
import { Temporal } from '../time';
import { type AccountPositionLine, type InstrumentPosition } from '../usecases/list-positions';
import { type PriceLookup } from './types';
import { valuePositions } from './value-positions';

const PLN = currency('PLN');
const USD = currency('USD');
const EUR = currency('EUR');

const ASOF = Temporal.PlainDate.from('2026-08-13');
const FETCHED_AT = Temporal.Instant.from('2026-08-13T12:00:00Z');

function freshPrice(close: Money): PriceLookup {
  return { status: 'fresh', close, asOf: ASOF, fetchedAt: FETCHED_AT };
}

function unavailablePrice(): PriceLookup {
  return { status: 'unavailable', reason: 'never-fetched' };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: accountId('11111111-1111-4111-8111-111111111111'),
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
    id: instrumentId('22222222-2222-4222-8222-222222222222'),
    kind: 'equity',
    isin: null,
    symbol: 'AAPL',
    exchange: null,
    currency: USD,
    name: 'Apple Inc.',
    ...overrides,
  };
}

function makeLine(overrides: Partial<AccountPositionLine> = {}): AccountPositionLine {
  const account = overrides.account ?? makeAccount();
  const costBasis = overrides.costBasis ?? Money.of('400', account.currency);
  return {
    account,
    quantity: new Decimal('10'),
    costBasis,
    averageCost: costBasis.amount.dividedBy('10'),
    realized: Money.zero(costBasis.currency),
    lots: [],
    ...overrides,
  };
}

function makePosition(
  lines: readonly AccountPositionLine[],
  overrides: Partial<InstrumentPosition> = {},
): InstrumentPosition {
  const instrument = overrides.instrument ?? makeInstrument();
  const quantity = lines.reduce((total, line) => total.plus(line.quantity), new Decimal(0));
  return {
    instrument,
    quantity,
    costBasisByCurrency: [],
    averageCost: null,
    realizedByCurrency: [],
    lines,
    ...overrides,
  };
}

describe('valuePositions', () => {
  it('values unrealized P&L in the cost-basis currency, not the instrument currency', () => {
    // PLN account, USD instrument, quantity 10, cost basis 400 PLN.
    const line = makeLine({
      account: makeAccount({ currency: PLN }),
      costBasis: Money.of('400', PLN),
    });
    const position = makePosition([line], { instrument: makeInstrument({ currency: USD }) });

    const prices = new Map([[position.instrument.id, freshPrice(Money.of('50', USD))]]);
    const rates = new Map([[USD, new Decimal('4')]]);

    const result = valuePositions([position], prices, rates);

    const [valued] = result.positions;
    const [valuedLine] = valued!.lines;
    // market value = 10 * 50 USD = 500 USD -> 500 * 4 = 2000 PLN; unrealized = 2000 - 400 = 1600 PLN
    expect(valuedLine!.unrealized?.currency).toBe(PLN);
    expect(valuedLine!.unrealized?.equals(Money.of('1600', PLN))).toBe(true);
    expect(result.totalIsComplete).toBe(true);
  });

  it('reports unrealized as null and totalIsComplete as false when the FX rate is missing', () => {
    const line = makeLine({
      account: makeAccount({ currency: PLN }),
      costBasis: Money.of('400', PLN),
    });
    const position = makePosition([line], { instrument: makeInstrument({ currency: USD }) });

    const prices = new Map([[position.instrument.id, freshPrice(Money.of('50', USD))]]);
    const rates = new Map<typeof USD, Decimal>(); // no USD rate on file

    const result = valuePositions([position], prices, rates);

    const [valued] = result.positions;
    const [valuedLine] = valued!.lines;
    expect(valuedLine!.unrealized).toBeNull();
    expect(result.totalIsComplete).toBe(false);
    // Neither 0 nor Infinity nor a thrown error.
    expect(Number.isFinite(result.totalMarketValuePln.amount.toNumber())).toBe(true);
  });

  it('nulls out marketValue and flips totalIsComplete false when the price is unavailable', () => {
    const line = makeLine({ quantity: new Decimal('10') });
    const position = makePosition([line]);

    const prices = new Map([[position.instrument.id, unavailablePrice()]]);
    const rates = new Map<typeof USD, Decimal>();

    const result = valuePositions([position], prices, rates);

    const [valued] = result.positions;
    const [valuedLine] = valued!.lines;
    expect(valuedLine!.marketValue).toBeNull();
    expect(valuedLine!.unrealized).toBeNull();
    expect(result.totalIsComplete).toBe(false);
  });

  it('keeps unrealized separate per cost-basis currency, never blended', () => {
    const plnAccount = makeAccount({ currency: PLN });
    const eurAccount = makeAccount({
      id: accountId('33333333-3333-4333-8333-333333333333'),
      currency: EUR,
    });
    const instrument = makeInstrument({ currency: USD });

    const plnLine = makeLine({
      account: plnAccount,
      quantity: new Decimal('10'),
      costBasis: Money.of('400', PLN),
    });
    const eurLine = makeLine({
      account: eurAccount,
      quantity: new Decimal('5'),
      costBasis: Money.of('100', EUR),
    });

    const position = makePosition([plnLine, eurLine], { instrument });

    const prices = new Map([[instrument.id, freshPrice(Money.of('50', USD))]]);
    const rates = new Map([
      [USD, new Decimal('4')],
      [EUR, new Decimal('4.3')],
    ]);

    const result = valuePositions([position], prices, rates);

    const [valued] = result.positions;
    expect(valued!.unrealizedByCurrency).toHaveLength(2);
    const currencies = valued!.unrealizedByCurrency.map((amount) => amount.currency).sort();
    expect(currencies).toEqual([EUR, PLN].sort());
  });

  it('does not flip totalIsComplete false for a fully closed position with no price', () => {
    const line = makeLine({ quantity: new Decimal('0'), costBasis: Money.zero(PLN) });
    const position = makePosition([line]);
    expect(position.quantity.isZero()).toBe(true);

    const prices = new Map<typeof position.instrument.id, PriceLookup>(); // no price at all
    const rates = new Map<typeof USD, Decimal>();

    const result = valuePositions([position], prices, rates);

    expect(result.totalIsComplete).toBe(true);
  });

  it('treats a PLN instrument in a PLN account as a no-op conversion, never touching the rate map', () => {
    const line = makeLine({
      account: makeAccount({ currency: PLN }),
      quantity: new Decimal('10'),
      costBasis: Money.of('400', PLN),
    });
    const instrument = makeInstrument({ currency: PLN });
    const position = makePosition([line], { instrument });

    const prices = new Map([[instrument.id, freshPrice(Money.of('50', PLN))]]);
    const rates = new Map<typeof USD, Decimal>(); // deliberately empty — PLN short-circuits before any lookup

    const result = valuePositions([position], prices, rates);

    const [valued] = result.positions;
    const [valuedLine] = valued!.lines;
    // market value = 10 * 50 PLN = 500 PLN; unrealized = 500 - 400 = 100 PLN
    expect(valuedLine!.marketValue?.equals(Money.of('500', PLN))).toBe(true);
    expect(valuedLine!.unrealized?.equals(Money.of('100', PLN))).toBe(true);
    expect(result.totalIsComplete).toBe(true);
  });

  it('sums totalMarketValuePln across multiple valuable positions', () => {
    const instrumentA = makeInstrument({
      id: instrumentId('44444444-4444-4444-8444-444444444444'),
      currency: PLN,
    });
    const instrumentB = makeInstrument({
      id: instrumentId('55555555-5555-4555-8555-555555555555'),
      currency: USD,
    });

    const lineA = makeLine({
      account: makeAccount({ currency: PLN }),
      quantity: new Decimal('10'),
      costBasis: Money.of('100', PLN),
    });
    const lineB = makeLine({
      account: makeAccount({ currency: PLN }),
      quantity: new Decimal('2'),
      costBasis: Money.of('100', PLN),
    });

    const positionA = makePosition([lineA], { instrument: instrumentA });
    const positionB = makePosition([lineB], { instrument: instrumentB });

    const prices = new Map([
      [instrumentA.id, freshPrice(Money.of('50', PLN))], // 10 * 50 = 500 PLN
      [instrumentB.id, freshPrice(Money.of('20', USD))], // 2 * 20 = 40 USD -> 160 PLN
    ]);
    const rates = new Map([[USD, new Decimal('4')]]);

    const result = valuePositions([positionA, positionB], prices, rates);

    expect(result.totalIsComplete).toBe(true);
    expect(result.totalMarketValuePln.equals(Money.of('660', PLN))).toBe(true);
  });
});
