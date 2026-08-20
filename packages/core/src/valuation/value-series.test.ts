import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  accountId,
  instrumentId,
  transactionId,
  type Account,
  type InstrumentId,
  type Transaction,
} from '../ledger/types';
import { currency, Money, type Currency } from '../money';
import { buildPositions, UnsupportedTransactionTypeError } from '../positions/build-positions';
import { Temporal } from '../time';
import { convertViaPln } from './convert';
import { type FxRate, type PriceBar } from './types';
import { portfolioValueSeries, sampleDates, type ValuePoint } from './value-series';

const PLN = currency('PLN');
const USD = currency('USD');
const EUR = currency('EUR');

const AAPL = instrumentId('00000000-0000-4000-9000-000000000001');
const VOO = instrumentId('00000000-0000-4000-9000-000000000002');
const BOND = instrumentId('00000000-0000-4000-9000-000000000003');
const PLN_ETF = instrumentId('00000000-0000-4000-9000-000000000004');

const ACCOUNT = accountId('11111111-1111-4111-8111-111111111111');

function d(iso: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(iso);
}

function bar(id: InstrumentId, date: string, close: string, ccy: Currency = USD): PriceBar {
  return { instrumentId: id, date: d(date), close: Money.of(close, ccy) };
}

function fx(code: Currency, date: string, mid: string): FxRate {
  return { currency: code, date: d(date), mid: new Decimal(mid) };
}

let txSeq = 0;

/**
 * Builds a `Transaction` with every field the interface requires filled in
 * with an inert default, so each test only states the fields it actually
 * cares about. `fee`/`tax` default to zero *in the transaction's own
 * currency* — leaving them in PLN regardless would trip `Money`'s currency
 * guard the moment a test uses a non-PLN transaction currency together with
 * `buildPositions` (rule 1: `costBasisOf` adds `fee` straight onto the gross
 * leg, which must be the same currency).
 */
function tx(
  overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'tradeDate'>,
): Transaction {
  txSeq += 1;
  const txCurrency = overrides.currency ?? PLN;
  return {
    id: transactionId(`00000000-0000-4000-a000-${String(txSeq).padStart(12, '0')}`),
    accountId: ACCOUNT,
    instrumentId: AAPL,
    settleDate: null,
    quantity: new Decimal(0),
    price: null,
    grossAmount: null,
    fee: Money.zero(txCurrency),
    tax: Money.zero(txCurrency),
    currency: txCurrency,
    fxRate: null,
    fxRateSource: null,
    source: 'manual',
    externalId: null,
    importBatchId: null,
    editedAfterImport: false,
    deleted: false,
    matchedLotIds: null,
    note: null,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: ACCOUNT,
    name: 'Test account',
    broker: 'XTB',
    wrapper: 'brokerage',
    currency: PLN,
    openedAt: Temporal.PlainDate.from('2020-01-01'),
    closedAt: null,
    ...overrides,
  };
}

function expectMoney(actual: Money, amount: string, ccy: Currency): void {
  expect(actual.currency).toBe(ccy);
  expect(actual.equals(Money.of(amount, ccy))).toBe(true);
}

function isStrictlyAscending(dates: readonly Temporal.PlainDate[]): boolean {
  return dates.every((date, i) => i === 0 || Temporal.PlainDate.compare(dates[i - 1]!, date) < 0);
}

describe('sampleDates', () => {
  it('returns a single-element array when from equals to, for every grain', () => {
    for (const grain of ['day', 'week', 'month'] as const) {
      const result = sampleDates(d('2026-03-10'), d('2026-03-10'), grain);
      expect(result).toHaveLength(1);
      expect(result[0]!.toString()).toBe('2026-03-10');
    }
  });

  it('day grain includes every calendar day between from and to, inclusive', () => {
    const result = sampleDates(d('2026-06-01'), d('2026-06-05'), 'day');
    expect(result.map((date) => date.toString())).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  /**
   * Bucket cadence is anchored at `from`, stepping by seven days, rather than
   * aligned to calendar week boundaries (e.g. ISO Mondays) — nothing in the
   * spec requires the latter, and anchoring at `from` is what makes "the last
   * entry is always `to`, appended even off-cadence" unambiguous to test.
   * Flag this to the implementer: if a calendar-aligned bucketing is
   * preferred instead, these two tests are the ones to renegotiate.
   */
  it('week grain steps 7 days from "from" and appends "to" when it lands off-cadence', () => {
    const result = sampleDates(d('2026-01-01'), d('2026-01-31'), 'week');
    expect(result.map((date) => date.toString())).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
      '2026-01-22',
      '2026-01-29',
      '2026-01-31',
    ]);
  });

  it('week grain does not duplicate "to" when it already lands on a bucket boundary', () => {
    const result = sampleDates(d('2026-01-01'), d('2026-01-15'), 'week');
    expect(result.map((date) => date.toString())).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
    ]);
  });

  it('month grain steps one calendar month from "from" and appends "to" when it lands off-cadence', () => {
    const result = sampleDates(d('2026-01-15'), d('2026-04-10'), 'month');
    expect(result.map((date) => date.toString())).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-10',
    ]);
  });

  it('month grain does not duplicate "to" when it already lands on a bucket boundary', () => {
    const result = sampleDates(d('2026-01-15'), d('2026-03-15'), 'month');
    expect(result.map((date) => date.toString())).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('always starts at "from" and ends at "to", strictly ascending, for week and month', () => {
    for (const grain of ['week', 'month'] as const) {
      const from = d('2026-02-03');
      const to = d('2026-05-27');
      const result = sampleDates(from, to, grain);

      expect(result[0]!.equals(from)).toBe(true);
      expect(result.at(-1)!.equals(to)).toBe(true);
      expect(isStrictlyAscending(result)).toBe(true);
    }
  });
});

describe('portfolioValueSeries', () => {
  describe('folding the ledger forward', () => {
    it('sums opening/closing types across accounts and ignores cash-only and unrelated transactions', () => {
      const accountB = accountId('22222222-2222-4222-8222-222222222222');
      const transactions: Transaction[] = [
        tx({
          type: 'buy',
          tradeDate: d('2026-01-05'),
          accountId: ACCOUNT,
          instrumentId: AAPL,
          quantity: new Decimal('10'),
        }),
        tx({
          type: 'buy',
          tradeDate: d('2026-01-10'),
          accountId: accountB,
          instrumentId: AAPL,
          quantity: new Decimal('5'),
        }),
        tx({
          type: 'sell',
          tradeDate: d('2026-01-15'),
          accountId: ACCOUNT,
          instrumentId: AAPL,
          quantity: new Decimal('3'),
        }),
        // Pure cash — no instrument — must never affect a position quantity.
        tx({
          type: 'deposit',
          tradeDate: d('2026-01-01'),
          accountId: ACCOUNT,
          instrumentId: null,
          quantity: new Decimal('1000'),
        }),
        // Has an instrument but is not an opening/closing type.
        tx({
          type: 'dividend',
          tradeDate: d('2026-01-06'),
          accountId: ACCOUNT,
          instrumentId: AAPL,
          quantity: new Decimal('0'),
        }),
      ];

      const dates = [d('2026-01-01'), d('2026-01-06'), d('2026-01-12'), d('2026-01-20')];
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-01-01', '100', USD)]]]);
      const fxHistory = new Map([[USD, [fx(USD, '2026-01-01', '4')]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory,
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: PLN,
      });

      expect(series).toHaveLength(4);
      // Before the first buy: nothing held.
      expectMoney(series[0]!.value, '0', PLN);
      expect(series[0]!.status).toBe('complete');
      // 10 units (first buy only).
      expectMoney(series[1]!.value, '4000', PLN); // 10 * 100 * 4
      // 15 units (both buys, across two accounts, summed into one instrument).
      expectMoney(series[2]!.value, '6000', PLN); // 15 * 100 * 4
      // 12 units (both buys minus the sell).
      expectMoney(series[3]!.value, '4800', PLN); // 12 * 100 * 4
      expect(series.every((point) => point.status === 'complete')).toBe(true);
    });
  });

  describe('pricing a non-bond instrument', () => {
    it('carries the last bar forward across a weekend gap rather than interpolating', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-02-01'),
          instrumentId: AAPL,
          quantity: new Decimal('1'),
        }),
      ];
      const dates = [d('2026-02-02'), d('2026-02-06'), d('2026-02-09')];
      const priceHistory = new Map([
        [AAPL, [bar(AAPL, '2026-02-02', '100'), bar(AAPL, '2026-02-09', '110')]],
      ]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory: new Map(),
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: USD, // same currency as the instrument — isolates pricing from FX.
      });

      expectMoney(series[0]!.value, '100', USD); // exact match on 02-02
      expectMoney(series[1]!.value, '100', USD); // carried forward from 02-02 across the gap
      expectMoney(series[2]!.value, '110', USD); // exact match on 02-09
      expect(series.every((point) => point.status === 'complete')).toBe(true);
    });

    it('marks the point partial and names the instrument in unpriced when no bar exists at or before the date', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-03-01'),
          instrumentId: AAPL,
          quantity: new Decimal('1'),
        }),
      ];
      const dates = [d('2026-03-05'), d('2026-03-10')];
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-03-10', '100')]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory: new Map(),
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: USD,
      });

      expect(series[0]!.status).toBe('partial');
      expect(series[0]!.unpriced).toEqual([AAPL]);
      expectMoney(series[0]!.value, '0', USD);

      expect(series[1]!.status).toBe('complete');
      expect(series[1]!.unpriced).toEqual([]);
      expectMoney(series[1]!.value, '100', USD);
    });

    it('sums only the priced holdings and marks the point partial when one of several is unvaluable', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-04-01'),
          instrumentId: AAPL,
          quantity: new Decimal('2'),
        }),
        tx({
          type: 'buy',
          tradeDate: d('2026-04-01'),
          instrumentId: VOO,
          quantity: new Decimal('3'),
        }),
      ];
      const dates = [d('2026-04-02')];
      // Only AAPL has ever been priced; VOO has no bar at all.
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-04-01', '100')]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory: new Map(),
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([
          [AAPL, USD],
          [VOO, USD],
        ]),
        presentIn: USD,
      });

      expect(series[0]!.status).toBe('partial');
      expect(series[0]!.unpriced).toEqual([VOO]);
      expectMoney(series[0]!.value, '200', USD); // 2 * 100, VOO's 3 units contribute nothing
    });
  });

  describe('pricing a bond', () => {
    it('looks up bondUnitValues by ISO date instead of priceHistory, and reports missing the same way', () => {
      const transactions = [
        tx({
          type: 'bond_purchase',
          tradeDate: d('2026-03-01'),
          instrumentId: BOND,
          quantity: new Decimal('100'),
          currency: PLN,
        }),
      ];
      const dates = [d('2026-03-05'), d('2026-03-10')];
      const bondUnitValues = new Map([[BOND, new Map([['2026-03-05', Money.of('1.05', PLN)]])]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory: new Map(),
        fxHistory: new Map(),
        bondUnitValues,
        instrumentCurrency: new Map([[BOND, PLN]]),
        presentIn: PLN,
      });

      expect(series[0]!.status).toBe('complete');
      expectMoney(series[0]!.value, '105', PLN); // 100 * 1.05

      expect(series[1]!.status).toBe('partial');
      expect(series[1]!.unpriced).toEqual([BOND]);
      expectMoney(series[1]!.value, '0', PLN);
    });

    it('folds bond_purchase/bond_redemption/bond_early_redemption through the same opening/closing rule as any instrument', () => {
      const transactions = [
        tx({
          type: 'bond_purchase',
          tradeDate: d('2026-03-01'),
          instrumentId: BOND,
          quantity: new Decimal('100'),
          currency: PLN,
        }),
        tx({
          type: 'bond_early_redemption',
          tradeDate: d('2026-03-15'),
          instrumentId: BOND,
          quantity: new Decimal('100'),
          currency: PLN,
        }),
      ];
      // No bondUnitValues entry at all for 03-20 — if the bond were still
      // considered held, this would have to come back partial/unpriced.
      const dates = [d('2026-03-10'), d('2026-03-20')];
      const bondUnitValues = new Map([[BOND, new Map([['2026-03-10', Money.of('1.02', PLN)]])]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory: new Map(),
        fxHistory: new Map(),
        bondUnitValues,
        instrumentCurrency: new Map([[BOND, PLN]]),
        presentIn: PLN,
      });

      expectMoney(series[0]!.value, '102', PLN); // held: 100 * 1.02
      expect(series[0]!.status).toBe('complete');

      // Fully redeemed by 03-20: not held, so no lookup is even attempted.
      expectMoney(series[1]!.value, '0', PLN);
      expect(series[1]!.status).toBe('complete');
      expect(series[1]!.unpriced).toEqual([]);
    });
  });

  describe('currency conversion', () => {
    it('carries the last FX rate forward the same way prices are carried forward', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-04-01'),
          instrumentId: AAPL,
          quantity: new Decimal('1'),
          currency: USD,
        }),
      ];
      const dates = [d('2026-04-05'), d('2026-04-10')];
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-04-01', '50')]]]);
      const fxHistory = new Map([
        [USD, [fx(USD, '2026-04-02', '4.0'), fx(USD, '2026-04-10', '4.2')]],
      ]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory,
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: PLN,
      });

      expectMoney(series[0]!.value, '200', PLN); // 1 * 50 * 4.0, carried forward from 04-02
      expect(series[0]!.status).toBe('complete');
      expectMoney(series[1]!.value, '210', PLN); // 1 * 50 * 4.2, exact match on 04-10
      expect(series[1]!.status).toBe('complete');
    });

    it('marks the point partial when a price exists but no FX rate covers the date yet', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-04-01'),
          instrumentId: AAPL,
          quantity: new Decimal('1'),
          currency: USD,
        }),
      ];
      const dates = [d('2026-04-01')];
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-04-01', '50')]]]);
      // First rate arrives the day after the query date.
      const fxHistory = new Map([[USD, [fx(USD, '2026-04-02', '4.0')]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory,
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: PLN,
      });

      expect(series[0]!.status).toBe('partial');
      expect(series[0]!.unpriced).toEqual([AAPL]);
      expectMoney(series[0]!.value, '0', PLN);
    });

    it('needs no FX rate for a PLN instrument, even with an empty fxHistory', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-04-01'),
          instrumentId: PLN_ETF,
          quantity: new Decimal('2'),
          currency: PLN,
        }),
      ];
      const dates = [d('2026-04-01')];
      const priceHistory = new Map([[PLN_ETF, [bar(PLN_ETF, '2026-04-01', '10', PLN)]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory: new Map(), // deliberately empty — PLN never needs a rate
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[PLN_ETF, PLN]]),
        presentIn: PLN,
      });

      expect(series[0]!.status).toBe('complete');
      expectMoney(series[0]!.value, '20', PLN);
    });

    it('needs no FX rate when the instrument currency already matches presentIn, even both non-PLN', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-04-01'),
          instrumentId: AAPL,
          quantity: new Decimal('3'),
          currency: USD,
        }),
      ];
      const dates = [d('2026-04-01')];
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-04-01', '10')]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory: new Map(), // no USD rate at all — must not be needed
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: USD,
      });

      expect(series[0]!.status).toBe('complete');
      expectMoney(series[0]!.value, '30', USD);
    });
  });

  describe('summing', () => {
    it('reports zero and complete for a date before any instrument was ever held', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-05-10'),
          instrumentId: AAPL,
          quantity: new Decimal('5'),
          currency: USD,
        }),
      ];
      const dates = [d('2026-05-01')];

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory: new Map(), // no prices needed — nothing to price yet
        fxHistory: new Map(),
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: PLN,
      });

      expect(series[0]!.status).toBe('complete');
      expect(series[0]!.unpriced).toEqual([]);
      expectMoney(series[0]!.value, '0', PLN);
    });

    it('contributes nothing and lists nothing in unpriced for an instrument sold back to zero', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-06-01'),
          instrumentId: AAPL,
          quantity: new Decimal('5'),
          currency: USD,
        }),
        tx({
          type: 'sell',
          tradeDate: d('2026-06-10'),
          instrumentId: AAPL,
          quantity: new Decimal('5'),
          currency: USD,
        }),
      ];
      const dates = [d('2026-06-05'), d('2026-06-20')];
      // No bar at all covering 06-20 — proves the exited holding is never
      // looked up, not that a lookup happened to succeed.
      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-06-01', '100')]]]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory: new Map(),
        bondUnitValues: new Map(),
        instrumentCurrency: new Map([[AAPL, USD]]),
        presentIn: USD,
      });

      expectMoney(series[0]!.value, '500', USD); // held: 5 * 100
      expect(series[0]!.status).toBe('complete');

      expectMoney(series[1]!.value, '0', USD); // fully sold — contributes nothing
      expect(series[1]!.status).toBe('complete');
      expect(series[1]!.unpriced).toEqual([]);
    });
  });

  describe('split transactions', () => {
    it('throws UnsupportedTransactionTypeError, the same class buildPositions throws', () => {
      const transactions = [
        tx({
          type: 'split',
          tradeDate: d('2026-07-01'),
          instrumentId: AAPL,
          quantity: new Decimal('2'),
          currency: USD,
        }),
      ];

      expect(() =>
        portfolioValueSeries({
          dates: [d('2026-07-01')],
          transactions,
          priceHistory: new Map(),
          fxHistory: new Map(),
          bondUnitValues: new Map(),
          instrumentCurrency: new Map([[AAPL, USD]]),
          presentIn: PLN,
        }),
      ).toThrow(UnsupportedTransactionTypeError);
    });
  });

  describe('parity with the buildPositions/valuePositions path', () => {
    it("matches an independently computed market value for the series' last (today) date", () => {
      const accountUsdA = accountId('66666666-6666-4666-8666-666666666666');
      const accountUsdB = accountId('77777777-7777-4777-8777-777777777777');
      const accountPln = accountId('88888888-8888-4888-8888-888888888888');

      const accounts: Account[] = [
        makeAccount({ id: accountUsdA, currency: USD }),
        makeAccount({ id: accountUsdB, currency: USD }),
        makeAccount({ id: accountPln, currency: PLN }),
      ];

      const transactions: Transaction[] = [
        tx({
          type: 'buy',
          tradeDate: d('2026-01-05'),
          accountId: accountUsdA,
          instrumentId: AAPL,
          quantity: new Decimal('10'),
          currency: USD,
          price: Money.of('90', USD),
        }),
        tx({
          type: 'buy',
          tradeDate: d('2026-01-10'),
          accountId: accountUsdB,
          instrumentId: AAPL,
          quantity: new Decimal('5'),
          currency: USD,
          price: Money.of('95', USD),
        }),
        tx({
          type: 'sell',
          tradeDate: d('2026-02-01'),
          accountId: accountUsdA,
          instrumentId: AAPL,
          quantity: new Decimal('3'),
          currency: USD,
          price: Money.of('110', USD),
        }),
        tx({
          type: 'bond_purchase',
          tradeDate: d('2026-01-08'),
          accountId: accountPln,
          instrumentId: BOND,
          quantity: new Decimal('50'),
          currency: PLN,
          price: Money.of('1', PLN),
        }),
      ];

      const today = d('2026-02-15');
      const dates = [d('2026-01-01'), today];

      const priceHistory = new Map([[AAPL, [bar(AAPL, '2026-02-15', '120')]]]);
      const bondUnitValues = new Map([[BOND, new Map([['2026-02-15', Money.of('1.05', PLN)]])]]);
      const fxHistory = new Map([[USD, [fx(USD, '2026-02-15', '4.00')]]]);
      const instrumentCurrency = new Map([
        [AAPL, USD],
        [BOND, PLN],
      ]);

      const series = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory,
        bondUnitValues,
        instrumentCurrency,
        presentIn: PLN,
      });

      // Independently: fold the same ledger through buildPositions (the
      // production position-accounting path) and value it by hand with the
      // same "today" price/rate the series was given.
      const positions = buildPositions(transactions, accounts);
      const aaplQuantity = positions
        .filter((position) => position.instrumentId === AAPL)
        .reduce((total, position) => total.plus(position.quantity), new Decimal(0));
      const bondQuantity = positions
        .filter((position) => position.instrumentId === BOND)
        .reduce((total, position) => total.plus(position.quantity), new Decimal(0));

      expect(aaplQuantity.toString()).toBe('12'); // 10 + 5 - 3, across two accounts
      expect(bondQuantity.toString()).toBe('50');

      const aaplMarketValueUsd = Money.of('120', USD).times(aaplQuantity);
      const aaplMarketValuePln = convertViaPln(
        aaplMarketValueUsd,
        PLN,
        new Map([[USD, new Decimal('4.00')]]),
      );
      const bondMarketValuePln = Money.of('1.05', PLN).times(bondQuantity);
      const expectedTotal = aaplMarketValuePln.plus(bondMarketValuePln);

      const last = series.at(-1)!;
      expect(last.date.equals(today)).toBe(true);
      expect(last.status).toBe('complete');
      expect(last.value.equals(expectedTotal)).toBe(true);
    });
  });

  describe('round trip through a second presentation currency', () => {
    it('returns to the original PLN figure after converting to EUR and back via the same rates', () => {
      const transactions = [
        tx({
          type: 'buy',
          tradeDate: d('2026-05-01'),
          instrumentId: PLN_ETF,
          quantity: new Decimal('20'),
          currency: PLN,
        }),
      ];
      const dates = [d('2026-05-01'), d('2026-05-10')];
      const priceHistory = new Map([[PLN_ETF, [bar(PLN_ETF, '2026-05-10', '25', PLN)]]]);
      const fxHistory = new Map([[EUR, [fx(EUR, '2026-05-10', '4.30')]]]);
      const instrumentCurrency = new Map([[PLN_ETF, PLN]]);

      const seriesPln = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory,
        bondUnitValues: new Map(),
        instrumentCurrency,
        presentIn: PLN,
      });
      const seriesEur = portfolioValueSeries({
        dates,
        transactions,
        priceHistory,
        fxHistory,
        bondUnitValues: new Map(),
        instrumentCurrency,
        presentIn: EUR,
      });

      const lastPln = seriesPln.at(-1) as ValuePoint;
      const lastEur = seriesEur.at(-1) as ValuePoint;

      expect(lastPln.status).toBe('complete');
      expect(lastEur.status).toBe('complete');
      expect(lastPln.value.currency).toBe(PLN);
      expect(lastEur.value.currency).toBe(EUR);

      const backToPln = convertViaPln(lastEur.value, PLN, new Map([[EUR, new Decimal('4.30')]]));

      // Not bit-exact by construction (rounding through two hops) — see the
      // same tolerance rationale in convert.test.ts's round-trip suite.
      expect(backToPln.amount.toFixed(2)).toBe(lastPln.value.amount.toFixed(2));
      expect(backToPln.amount.minus(lastPln.value.amount).abs().lessThan('1e-20')).toBe(true);
    });
  });
});
