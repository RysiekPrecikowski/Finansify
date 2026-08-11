import { Money, Temporal, currency, type Currency } from '@finansify/core';

/**
 * Demo data for the dashboard, standing in for the read model that Phase 1
 * (ledger) and Phase 2 (valuation) will produce. Everything derived — cost
 * basis, value, P&L, weights, the headline total — is *computed here from the
 * declared inputs* rather than typed in, so the numbers on screen agree with
 * each other and the layout can be checked against a hand-computed figure.
 *
 * Two deliberate choices:
 *
 * - **Single currency.** Every instrument is PLN-quoted. There is no FX adapter
 *   until Phase 2, and inventing a rate to make a mixed-currency total look
 *   plausible is exactly what rule 6 and ADR 0006 exist to prevent.
 * - **One unvaluable position and one no-price asset class.** A fund unit with
 *   no price feed must stay *visible as unvaluable* and out of the total, and
 *   cash has a value but no price. Both are easy to get wrong once, and then
 *   wrong forever.
 *
 * Delete this file when the ledger lands.
 */

export const PLN: Currency = currency('PLN');

export const assetClasses = ['equity', 'etf', 'fund', 'bond', 'cash'] as const;
export type AssetClass = (typeof assetClasses)[number];

export const wrappers = ['brokerage', 'ike', 'ikze', 'ppk'] as const;
export type Wrapper = (typeof wrappers)[number];

export const ranges = ['1D', '1W', '1M', 'YTD', '1Y', 'MAX'] as const;
export type Range = (typeof ranges)[number];

export const sortOrders = ['valueDesc', 'gainAbsoluteDesc', 'gainPercentDesc', 'nameAsc'] as const;
export type SortOrder = (typeof sortOrders)[number];

export interface HoldingValuation {
  /** `null` for cash: it has a value but no quoted price. */
  readonly price: Money | null;
  readonly value: Money;
  readonly gain: Money;
  readonly gainRatio: string;
  readonly changeToday: Money;
  readonly changeTodayRatio: string;
  readonly asOf: Temporal.Instant;
}

export interface Holding {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly wrapper: Wrapper;
  readonly quantity: string;
  readonly averageCost: Money;
  readonly cost: Money;
  /** `null` means no price could be obtained — never an estimate (rule 7). */
  readonly valuation: HoldingValuation | null;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly broker: string;
  readonly wrapper: Wrapper;
  readonly value: Money;
  /** Only IKE and IKZE have an annual contribution limit. */
  readonly contribution: {
    readonly used: Money;
    readonly limit: Money;
    readonly year: number;
  } | null;
}

export interface ValuePoint {
  readonly at: Temporal.Instant;
  readonly value: Money;
}

export interface PortfolioSnapshot {
  readonly name: string;
  readonly asOf: Temporal.Instant;
  readonly totalValue: Money;
  readonly totalCost: Money;
  readonly changeToday: Money;
  readonly changeTodayRatio: string;
  readonly changeTotal: Money;
  readonly changeTotalRatio: string;
  readonly holdings: readonly Holding[];
  readonly accounts: readonly Account[];
  readonly series: Readonly<Record<Range, readonly ValuePoint[]>>;
}

/** Fixed, so the demo never re-renders differently or drifts between requests. */
const asOf = Temporal.Instant.from('2026-08-11T15:35:00Z');

interface HoldingInput {
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly wrapper: Wrapper;
  readonly quantity: string;
  readonly averageCost: string;
  /** `null` when the provider has no price for this instrument. */
  readonly price: string | null;
  readonly previousClose: string | null;
}

const holdingInputs: readonly HoldingInput[] = [
  {
    symbol: 'CDR',
    name: 'CD Projekt',
    assetClass: 'equity',
    wrapper: 'brokerage',
    quantity: '120',
    averageCost: '185.40',
    price: '226.80',
    previousClose: '223.10',
  },
  {
    symbol: 'ETFBW20TR',
    name: 'Beta ETF WIG20TR',
    assetClass: 'etf',
    wrapper: 'ike',
    quantity: '420',
    averageCost: '78.30',
    price: '92.10',
    previousClose: '91.40',
  },
  {
    symbol: 'BETASPYPL',
    name: 'Beta ETF S&P 500 PLN-Hedged',
    assetClass: 'etf',
    wrapper: 'ikze',
    quantity: '260',
    averageCost: '51.80',
    price: '63.45',
    previousClose: '62.90',
  },
  {
    symbol: 'ALE',
    name: 'Allegro.eu',
    assetClass: 'equity',
    wrapper: 'ike',
    quantity: '150',
    averageCost: '31.20',
    price: '36.75',
    previousClose: '36.05',
  },
  {
    symbol: 'PKN',
    name: 'Orlen',
    assetClass: 'equity',
    wrapper: 'brokerage',
    quantity: '300',
    averageCost: '62.15',
    price: '58.40',
    previousClose: '59.20',
  },
  {
    symbol: 'EDO0735',
    name: 'Obligacje EDO (10-letnie, indeksowane)',
    assetClass: 'bond',
    wrapper: 'brokerage',
    quantity: '200',
    averageCost: '100.00',
    price: '104.62',
    previousClose: '104.61',
  },
  {
    symbol: 'ROR0826',
    name: 'Obligacje ROR (roczne, zmienny kupon)',
    assetClass: 'bond',
    wrapper: 'brokerage',
    quantity: '150',
    averageCost: '100.00',
    price: '100.51',
    previousClose: '100.50',
  },
  {
    symbol: 'PLN',
    name: 'Gotówka',
    assetClass: 'cash',
    wrapper: 'brokerage',
    quantity: '12480.00',
    averageCost: '1.00',
    price: null,
    previousClose: null,
  },
  {
    symbol: 'QRS',
    name: 'Quercus Agresywny (j.u.)',
    assetClass: 'fund',
    wrapper: 'brokerage',
    quantity: '340.5',
    averageCost: '42.10',
    price: null,
    previousClose: null,
  },
];

function ratio(numerator: Money, denominator: Money): string {
  if (denominator.isZero()) return '0';
  return numerator.amount.dividedBy(denominator.amount).toFixed(6);
}

function buildHolding(input: HoldingInput): Holding {
  const averageCost = Money.of(input.averageCost, PLN);
  const cost = averageCost.times(input.quantity);

  // Cash is valued at its face amount and has no price; the fund has neither,
  // and must therefore stay out of every total.
  if (input.assetClass === 'cash') {
    return {
      id: `${input.wrapper}-${input.symbol}`,
      symbol: input.symbol,
      name: input.name,
      assetClass: input.assetClass,
      wrapper: input.wrapper,
      quantity: input.quantity,
      averageCost,
      cost,
      valuation: {
        price: null,
        value: cost,
        gain: Money.zero(PLN),
        gainRatio: '0',
        changeToday: Money.zero(PLN),
        changeTodayRatio: '0',
        asOf,
      },
    };
  }

  if (input.price === null || input.previousClose === null) {
    return {
      id: `${input.wrapper}-${input.symbol}`,
      symbol: input.symbol,
      name: input.name,
      assetClass: input.assetClass,
      wrapper: input.wrapper,
      quantity: input.quantity,
      averageCost,
      cost,
      valuation: null,
    };
  }

  const price = Money.of(input.price, PLN);
  const value = price.times(input.quantity);
  const gain = value.minus(cost);
  const changeToday = price.minus(Money.of(input.previousClose, PLN)).times(input.quantity);
  const previousValue = Money.of(input.previousClose, PLN).times(input.quantity);

  return {
    id: `${input.wrapper}-${input.symbol}`,
    symbol: input.symbol,
    name: input.name,
    assetClass: input.assetClass,
    wrapper: input.wrapper,
    quantity: input.quantity,
    averageCost,
    cost,
    valuation: {
      price,
      value,
      gain,
      gainRatio: ratio(gain, cost),
      changeToday,
      changeTodayRatio: ratio(changeToday, previousValue),
      asOf,
    },
  };
}

const holdings: readonly Holding[] = holdingInputs.map(buildHolding);

function sumValued(pick: (valuation: HoldingValuation) => Money): Money {
  return holdings.reduce(
    (total, holding) => (holding.valuation === null ? total : total.plus(pick(holding.valuation))),
    Money.zero(PLN),
  );
}

const totalValue = sumValued((valuation) => valuation.value);
const changeToday = sumValued((valuation) => valuation.changeToday);

/** Cost basis of the *valued* positions only, so the ratio has a valid base. */
const totalCost = holdings.reduce(
  (total, holding) => (holding.valuation === null ? total : total.plus(holding.cost)),
  Money.zero(PLN),
);

const changeTotal = totalValue.minus(totalCost);

const accounts: readonly Account[] = [
  {
    id: 'bos-brokerage',
    name: 'Rachunek maklerski',
    broker: 'Bossa',
    wrapper: 'brokerage',
    value: wrapperValue('brokerage'),
    contribution: null,
  },
  {
    id: 'bos-ike',
    name: 'IKE',
    broker: 'Bossa',
    wrapper: 'ike',
    value: wrapperValue('ike'),
    // 2026 limits are placeholders until `wrapper_rules` exists (Phase 3).
    contribution: { used: Money.of('19200.00', PLN), limit: Money.of('28260.00', PLN), year: 2026 },
  },
  {
    id: 'xtb-ikze',
    name: 'IKZE',
    broker: 'XTB',
    wrapper: 'ikze',
    value: wrapperValue('ikze'),
    contribution: { used: Money.of('9840.00', PLN), limit: Money.of('11304.00', PLN), year: 2026 },
  },
];

function wrapperValue(wrapper: Wrapper): Money {
  return holdings.reduce(
    (total, holding) =>
      holding.wrapper === wrapper && holding.valuation !== null
        ? total.plus(holding.valuation.value)
        : total,
    Money.zero(PLN),
  );
}

/**
 * A deterministic walk ending at today's value. Seeded per range so the shape is
 * stable across renders — a chart that reshuffles on every request is useless
 * for eyeballing a layout.
 */
function walk(seed: number, count: number, from: Money, to: Money, stepMs: number): ValuePoint[] {
  const end = asOf.epochMilliseconds;
  const span = to.minus(from);
  let state = seed;

  const points: ValuePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const progress = index / (count - 1);
    const noise = state / 2147483648 - 0.5;

    // Trend plus noise, with the noise fading out so the series lands exactly on
    // today's value rather than near it.
    const drift = span.times(progress.toFixed(6));
    const wobble = span.abs().times((noise * 0.55 * (1 - progress)).toFixed(6));

    points.push({
      at: Temporal.Instant.fromEpochMilliseconds(end - (count - 1 - index) * stepMs),
      value: from.plus(drift).plus(wobble),
    });
  }

  return points;
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const series: Record<Range, readonly ValuePoint[]> = {
  '1D': walk(11, 34, totalValue.minus(changeToday), totalValue, 15 * minute),
  '1W': walk(23, 40, totalValue.times('0.982'), totalValue, 4 * hour),
  '1M': walk(37, 30, totalValue.times('0.955'), totalValue, day),
  YTD: walk(53, 32, totalValue.times('0.883'), totalValue, 7 * day),
  '1Y': walk(71, 52, totalValue.times('0.842'), totalValue, 7 * day),
  MAX: walk(97, 60, totalValue.times('0.463'), totalValue, 30 * day),
};

export const demoPortfolio: PortfolioSnapshot = {
  name: 'Portfel główny',
  asOf,
  totalValue,
  totalCost,
  changeToday,
  changeTodayRatio: ratio(changeToday, totalValue.minus(changeToday)),
  changeTotal,
  changeTotalRatio: ratio(changeTotal, totalCost),
  holdings,
  accounts,
  series,
};

export function filterByAssetClass(
  input: readonly Holding[],
  assetClass: AssetClass | null,
): readonly Holding[] {
  return assetClass === null ? input : input.filter((holding) => holding.assetClass === assetClass);
}

export function sortHoldings(input: readonly Holding[], order: SortOrder): readonly Holding[] {
  // Unvaluable positions sort last whatever the order: they have no number to
  // compare, and hiding them at the top of a "biggest gains" list would be worse
  // than useless.
  const compare = (left: Holding, right: Holding): number => {
    if (left.valuation === null || right.valuation === null) {
      if (left.valuation === right.valuation) return left.symbol.localeCompare(right.symbol);
      return left.valuation === null ? 1 : -1;
    }

    switch (order) {
      case 'valueDesc':
        return right.valuation.value.amount.comparedTo(left.valuation.value.amount);
      case 'gainAbsoluteDesc':
        return right.valuation.gain.amount.comparedTo(left.valuation.gain.amount);
      case 'gainPercentDesc': {
        // Cross-multiply rather than compare ratios as numbers — same ordering,
        // no float conversion.
        const leftCross = left.valuation.gain.amount.times(right.cost.amount);
        const rightCross = right.valuation.gain.amount.times(left.cost.amount);
        return rightCross.comparedTo(leftCross);
      }
      case 'nameAsc':
        return left.symbol.localeCompare(right.symbol);
    }
  };

  return [...input].sort(compare);
}
