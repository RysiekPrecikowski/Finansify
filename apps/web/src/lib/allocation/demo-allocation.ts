/**
 * `/allocation`'s data — **synthetic, and a placeholder for real use cases that
 * do not exist yet.**
 *
 * `packages/core` has no `getAllocation` and no `getRebalancePlan`. Both are
 * real future work and both are `core` code, which this repo writes test-first
 * (rule 17) against a spec — a target model, a tolerance band and an order
 * generator are exactly the kind of arithmetic that must be specified before it
 * is implemented, not reverse-engineered from a screen. So this module supplies
 * the figures the screen needs and nothing else, in the same
 * honestly-labelled-placeholder spirit as `lib/dashboard/benchmarks.ts` and
 * `lib/dashboard/demo-enrichment.ts`.
 *
 * Two honesty notes carried over from the design pass:
 *
 * - Most dimensions mirror the shape of a real portfolio (asset class, account,
 *   wrapper, concentration) and would map onto the read model `/portfolio`
 *   already builds.
 * - **`currency` and `region` are invented.** The demo ledger is PLN-only and
 *   `Instrument` carries no geography at all, so those two rings show a split
 *   that no query could produce today. They exist because the dimension row is
 *   part of the approved design, not because the data is there.
 *
 * When the real use cases land, everything below is deleted and the view keeps
 * its shape: the component consumes `AllocationModel` / `RebalanceRow` /
 * `Order`, never these constants directly.
 *
 * Plain `number`s throughout, deliberately. These are synthetic display
 * figures, not ledger money — the `Money`/`Decimal` rule governs values derived
 * from the ledger (ADR 0005), and inventing a `Decimal` pipeline for fixture
 * percentages would suggest a precision guarantee that does not exist here.
 */

export const dimensions = ['class', 'currency', 'account', 'wrapper', 'region', 'sector'] as const;
export type Dimension = (typeof dimensions)[number];

export const models = ['own', 'balanced', 'global', 'retirement'] as const;
export type ModelId = (typeof models)[number];

/** The four classes the rebalance model works in. Stable keys; labels come from the dictionary. */
export const assetClassKeys = ['equity', 'etf', 'bonds', 'cash'] as const;
export type AssetClassKey = (typeof assetClassKeys)[number];

export interface Slice {
  /** Key into `dictionary.allocation.labels`. */
  readonly labelKey: string;
  /** Percent of portfolio value, 0–100. */
  readonly share: number;
  /** Pre-formatted compact value, e.g. `55,2 tys.` — a fixture, not a computed `Money`. */
  readonly value: string;
}

/** Total portfolio value the money figures below are derived from. */
export const demoTotal = 153_908;

export const demoDimensions: Readonly<Record<Dimension, readonly Slice[]>> = {
  class: [
    { labelKey: 'etf', share: 35.9, value: '55,2 tys.' },
    { labelKey: 'equity', share: 32.6, value: '50,2 tys.' },
    { labelKey: 'bonds', share: 23.4, value: '36,0 tys.' },
    { labelKey: 'cash', share: 8.1, value: '12,5 tys.' },
  ],
  // Invented: the demo ledger holds PLN only (see the module note above).
  currency: [
    { labelKey: 'pln', share: 96.9, value: '149,1 tys.' },
    { labelKey: 'usd', share: 3.1, value: '4,8 tys.' },
  ],
  account: [
    { labelKey: 'brokerage', share: 60.6, value: '93,2 tys.' },
    { labelKey: 'ike', share: 28.7, value: '44,2 tys.' },
    { labelKey: 'ikze', share: 10.7, value: '16,5 tys.' },
  ],
  wrapper: [
    { labelKey: 'brokerage', share: 60.6, value: '93,2 tys.' },
    { labelKey: 'ike', share: 28.7, value: '44,2 tys.' },
    { labelKey: 'ikze', share: 10.7, value: '16,5 tys.' },
  ],
  // Invented: `Instrument` carries no geography (see the module note above).
  region: [
    { labelKey: 'poland', share: 89.3, value: '137,4 tys.' },
    { labelKey: 'usa', share: 10.7, value: '16,5 tys.' },
  ],
  sector: [
    { labelKey: 'indexEtf', share: 35.9, value: '55,2 tys.' },
    { labelKey: 'govBonds', share: 23.4, value: '36,0 tys.' },
    { labelKey: 'techGaming', share: 17.7, value: '27,2 tys.' },
    { labelKey: 'energy', share: 11.4, value: '17,5 tys.' },
    { labelKey: 'cash', share: 8.1, value: '12,5 tys.' },
    { labelKey: 'retail', share: 3.6, value: '5,5 tys.' },
  ],
};

/** Where the portfolio actually sits, per class. */
export const demoCurrent: Readonly<Record<AssetClassKey, number>> = {
  equity: 32.6,
  etf: 35.9,
  bonds: 23.4,
  cash: 8.1,
};

export const demoTargets: Readonly<Record<ModelId, Readonly<Record<AssetClassKey, number>>>> = {
  own: { equity: 30, etf: 38, bonds: 24, cash: 8 },
  balanced: { equity: 25, etf: 35, bonds: 40, cash: 0 },
  global: { equity: 20, etf: 60, bonds: 20, cash: 0 },
  retirement: { equity: 15, etf: 45, bonds: 35, cash: 5 },
};

/** The instrument each class would actually be traded through, and its unit price. */
export const demoLead: Partial<
  Record<AssetClassKey, { readonly symbol: string; readonly name: string; readonly price: number }>
> = {
  equity: { symbol: 'CDR', name: 'CD Projekt', price: 226.8 },
  etf: { symbol: 'ETFBW20TR', name: 'Beta ETF WIG20TR', price: 92.1 },
  bonds: { symbol: 'EDO0735', name: 'Obligacje EDO 10-letnie', price: 104.62 },
};

/** Contribution sizes the "new money only" mode offers, in złoty. */
export const demoAmounts = [2000, 5000, 10_000, 25_000] as const;

export const demoConcentration: readonly { readonly symbol: string; readonly share: number }[] = [
  { symbol: 'ETFBW20TR', share: 25.1 },
  { symbol: 'CDR', share: 17.7 },
  { symbol: 'EDO0735', share: 13.6 },
  { symbol: 'PKN', share: 11.4 },
  { symbol: 'BETASPYPL', share: 10.7 },
];

export const demoInstrumentTargets: readonly {
  readonly symbol: string;
  readonly now: number;
  readonly target: number;
}[] = [
  { symbol: 'ETFBW20TR', now: 36.7, target: 35 },
  { symbol: 'CDR', now: 25.8, target: 22 },
  { symbol: 'PKN', now: 16.6, target: 18 },
  { symbol: 'BETASPYPL', now: 15.6, target: 20 },
  { symbol: 'ALE', now: 5.2, target: 5 },
];

/**
 * Anything inside ±1 percentage point counts as on-target.
 *
 * A band, not an exact match, because rebalancing to the decimal costs a
 * commission and a tax event to fix a rounding difference — the row says "w
 * tolerancji" rather than naming an amount nobody should act on.
 */
export const toleranceBand = 1;

// ---------------------------------------------------------------------------
// Pure derivations. No I/O, no clock — the view calls these on every state
// change and the results are a function of (dimension, model, mode, amount).
// ---------------------------------------------------------------------------

export interface RingSegment {
  readonly path: string;
  readonly rampIndex: number;
}

/**
 * One donut arc. Ported from the approved artboard so the ring's proportions,
 * gap and start angle are the ones that were signed off rather than a second
 * guess at them: radius 54/34 in a 120-unit box, starting at twelve o'clock.
 */
function arcPath(startDeg: number, endDeg: number): string {
  const outer = 54;
  const inner = 34;
  const cx = 60;
  const cy = 60;
  const rad = (a: number) => (a * Math.PI) / 180;
  const f = (n: number) => n.toFixed(2);
  const large = endDeg - startDeg > 180 ? 1 : 0;

  const x0 = cx + outer * Math.cos(rad(startDeg));
  const y0 = cy + outer * Math.sin(rad(startDeg));
  const x1 = cx + outer * Math.cos(rad(endDeg));
  const y1 = cy + outer * Math.sin(rad(endDeg));
  const ix1 = cx + inner * Math.cos(rad(endDeg));
  const iy1 = cy + inner * Math.sin(rad(endDeg));
  const ix0 = cx + inner * Math.cos(rad(startDeg));
  const iy0 = cy + inner * Math.sin(rad(startDeg));

  return (
    `M${f(x0)} ${f(y0)}` +
    ` A${outer} ${outer} 0 ${large} 1 ${f(x1)} ${f(y1)}` +
    ` L${f(ix1)} ${f(iy1)}` +
    ` A${inner} ${inner} 0 ${large} 0 ${f(ix0)} ${f(iy0)} Z`
  );
}

/** The ring for one dimension, largest slice first, with a hairline gap between segments. */
export function buildRing(slices: readonly Slice[]): readonly RingSegment[] {
  let angle = -90;
  return slices.map((slice, index) => {
    const span = (slice.share / 100) * 360;
    const gap = Math.min(1.2, Math.max(0.6, span * 0.06));
    const segment = { path: arcPath(angle + gap / 2, angle + span - gap / 2), rampIndex: index };
    angle += span;
    return segment;
  });
}

export interface RebalanceRow {
  readonly key: AssetClassKey;
  readonly now: number;
  readonly target: number;
  /** Percentage points, signed. Positive means over target. */
  readonly deviation: number;
  readonly withinTolerance: boolean;
  /** Złoty to move to close the gap. Zero inside the band. */
  readonly amount: number;
  /** Half-width of the bidirectional bar, as a percentage of the track. */
  readonly barWidth: number;
}

export function buildRebalance(model: ModelId): readonly RebalanceRow[] {
  const targets = demoTargets[model];

  return assetClassKeys.map((key): RebalanceRow => {
    const now = demoCurrent[key];
    const target = targets[key];
    const deviation = now - target;
    const withinTolerance = Math.abs(deviation) <= toleranceBand;

    return {
      key,
      now,
      target,
      deviation,
      withinTolerance,
      amount: withinTolerance ? 0 : (Math.abs(deviation) / 100) * demoTotal,
      barWidth: Math.min(Math.abs(deviation) * 3.2, 50),
    };
  });
}

export interface Order {
  readonly key: AssetClassKey;
  readonly sell: boolean;
  readonly symbol: string;
  readonly name: string;
  readonly quantity: number;
  readonly amount: number;
}

/**
 * The orders a plan implies.
 *
 * Two modes, and the difference is the whole point of the section. Normally
 * every out-of-band class is traded, selling the overweight to buy the
 * underweight. In **contributions-only** mode nothing is sold: one new payment
 * is split across the underweight classes *in proportion to how short each one
 * is*, so the largest gap gets the largest share. That avoids realising a gain
 * — and the tax and commission that come with it — which is the reason a Polish
 * investor would choose it.
 */
export function buildOrders(
  rows: readonly RebalanceRow[],
  contributionsOnly: boolean,
  contribution: number,
): readonly Order[] {
  const tradable = rows.filter((row) => !row.withinTolerance && demoLead[row.key] !== undefined);
  const shortfalls = tradable.filter((row) => row.deviation < 0);

  const picks: readonly { row: RebalanceRow; sell: boolean; money: number }[] = contributionsOnly
    ? (() => {
        const total = shortfalls.reduce((sum, row) => sum + row.amount, 0);
        return shortfalls.map((row) => ({
          row,
          sell: false,
          money: total === 0 ? 0 : (contribution * row.amount) / total,
        }));
      })()
    : tradable.map((row) => ({ row, sell: row.deviation > 0, money: row.amount }));

  return picks.flatMap(({ row, sell, money }): Order[] => {
    const lead = demoLead[row.key];
    if (lead === undefined) return [];
    const quantity = Math.round(money / lead.price);
    if (quantity <= 0) return [];
    return [
      {
        key: row.key,
        sell,
        symbol: lead.symbol,
        name: lead.name,
        quantity,
        amount: quantity * lead.price,
      },
    ];
  });
}

/** Share of the portfolio held in the five largest positions. */
export function concentrationShare(): number {
  return demoConcentration.reduce((sum, entry) => sum + entry.share, 0);
}
