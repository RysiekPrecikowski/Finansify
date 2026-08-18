import {
  Money,
  Temporal,
  currency,
  interestTableKeyFor,
  parseSeriesCode,
  type BondInterestTable,
  type BondInterestTableKey,
  type BondInterestTableProvider,
  type BondSeriesCode,
  type PurchaseDayKey,
} from '@finansify/core';
import Decimal from 'decimal.js';

/**
 * The Ministry's own daily interest tables, served by Bank Pekao S.A. as an
 * emission agent — plain JSON, no authentication, no CSRF token, no WAF.
 *
 * This is the source `docs/data-sources.md` names for bond values, and the
 * reason it is reachable at all: obligacjeskarbowe.pl serves the same tables
 * from a POST form that PKO's WAF answers with 403, so the official figures
 * were unobtainable for a non-interactive client until this was found
 * (ADR 0016, corrected by ADR 0019).
 *
 * Three endpoints, and the middle one is the important one:
 *
 *   /type/{FAMILY}                    → the series that have tables at all
 *   /emissions/{SERIES}               → `{ "{period}-{purchaseDay}": "from - to" }`
 *   /emissions/{SERIES}/{period}-{day} → the header and the daily grid
 *
 * The purchase-day half of that key only ever takes the values 1, 29, 30 and
 * 31; `interestTableKeyFor` in `core` explains why that covers every purchase
 * day rather than four of them.
 */
const BASE_URL = 'https://www.pekao.com.pl/.rest/gb-interest-tables';

const PLN = currency('PLN');

/** The grid's column headers. The API writes months as Roman numerals. */
const MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const;

/**
 * No retail series has ever paid above 25% a year, and none can pay below zero
 * — the CPI families floor the index at zero before adding their margin. A rate
 * outside that band means the payload changed shape, and writing it would
 * re-value every holding of the series against a number nobody published.
 */
const MAX_PLAUSIBLE_RATE = new Decimal('0.25');

/**
 * The coarse guard, and deliberately far above the real range rather than snug
 * against it. A first cut capped a cell at the 100 zł nominal, on the reasoning
 * that interest cannot exceed the bond — true of the paying families, whose
 * tables restart at zero each period, and false of the capitalizing ones, whose
 * tables accumulate since issue. EDO runs ten years and ROD twelve; ROD's 2023
 * period alone paid 17,9%, and cumulative interest past 100 zł per bond needs
 * only about 6% a year averaged over the term. That band would have refused the
 * first period to cross it and dropped every holder of the series onto the
 * engine, silently — an outage dressed as a check, which is the mistake
 * ADR 0016 already recorded once against the CPI series.
 *
 * A hundred times the nominal is a value no series issued since these families
 * existed has approached, and it still catches a cell parsed out of the wrong
 * column. The sharp work is done below by contiguity, ordering, and the span
 * the table itself publishes.
 */
const MAX_PLAUSIBLE_VALUE = Money.of('10000', PLN);

export class UnreadableInterestTableError extends Error {
  constructor(series: string, key: string, detail: string) {
    super(
      `Pekao's interest table for ${series} ${key} could not be read: ${detail} — refusing it rather than valuing a holding against a table this adapter does not understand`,
    );
    this.name = 'UnreadableInterestTableError';
  }
}

/**
 * `"5,25%"` → `5.25`, and `"0,44"` → `0.44`. Never `parseFloat` (rule 1).
 *
 * Matched whole rather than stripped character by character. Peeling the `%`
 * and the comma off with `replace` reads as sanitizing a hostile string — and
 * is what CodeQL's `js/incomplete-sanitization` flags it as — when the intent
 * is the opposite: this is the *only* numeric shape the tables publish, and
 * anything else must be refused rather than tidied into something parseable.
 */
const PUBLISHED_NUMBER = /^(-?\d+)(?:,(\d+))?%?$/;

function toDecimal(raw: string): Decimal {
  // Trimmed before matching rather than matched with optional whitespace:
  // `\s*` on both sides of an optional group makes the pattern ambiguous, which
  // is a needless way to give a remote payload superlinear backtracking.
  const match = PUBLISHED_NUMBER.exec(raw.trim());
  if (match === null) throw new RangeError(`"${raw}" is not a number in the published format`);

  const [, whole = '', fraction] = match;
  const value = new Decimal(fraction === undefined ? whole : `${whole}.${fraction}`);
  if (!value.isFinite()) throw new RangeError(`"${raw}" is not a finite number`);
  return value;
}

/** `"31.08.2026"` → `2026-08-31`. The API dates in `DD.MM.YYYY`; we do not. */
function toPlainDate(raw: string): Temporal.PlainDate {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
  if (match === null) throw new RangeError(`"${raw}" is not a DD.MM.YYYY date`);
  const [, day, month, year] = match;
  return Temporal.PlainDate.from(`${year}-${month}-${day}`);
}

/** The shape of the payload, asserted rather than trusted. */
interface RawTableDocument {
  readonly series?: unknown;
  readonly interestFrom?: unknown;
  readonly interestTo?: unknown;
  readonly interestRatePercentage?: unknown;
  readonly interestPeriodNumber?: unknown;
  readonly interestPeriodDay?: unknown;
  readonly tables?: readonly {
    readonly name?: unknown;
    readonly header?: { readonly items?: readonly unknown[] };
    readonly rows?: readonly { readonly items?: readonly unknown[] }[];
  }[];
}

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Flatten the year-by-year grid into one value per calendar day.
 *
 * The grid is a calendar, not a list: rows are days of the month, columns are
 * months, and a cell is blank wherever that day does not exist in that month or
 * falls outside the period. So the payload has to be read cell by cell into
 * dated values and then sorted — reading it row-major would interleave months.
 */
function datedCells(
  document: RawTableDocument,
  fail: (detail: string) => never,
): readonly (readonly [Temporal.PlainDate, Money])[] {
  const cells: (readonly [Temporal.PlainDate, Money])[] = [];

  for (const table of document.tables ?? []) {
    const year = isString(table.name) ? Number.parseInt(table.name, 10) : Number.NaN;
    // The year is a calendar label, not money — `parseInt` is legitimate here
    // and only here, and it is validated before it can reach a date.
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      fail(`"${String(table.name)}" is not a year the grid can be dated against`);
    }

    const header = (table.header?.items ?? []).slice(1);
    for (const row of table.rows ?? []) {
      const items = row.items ?? [];
      const dayLabel = items[0];
      const day = isString(dayLabel) ? Number.parseInt(dayLabel, 10) : Number.NaN;
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        fail(`"${String(dayLabel)}" is not a day of the month`);
      }

      header.forEach((monthLabel, column) => {
        const raw = items[column + 1];
        if (!isString(raw) || raw.trim() === '') return;

        const month = MONTHS.indexOf(String(monthLabel) as (typeof MONTHS)[number]) + 1;
        if (month === 0) fail(`"${String(monthLabel)}" is not a Roman month`);

        let date: Temporal.PlainDate;
        let value: Money;
        try {
          date = Temporal.PlainDate.from({ year, month, day });
          value = Money.of(toDecimal(raw), PLN);
        } catch {
          fail(`cell ${String(monthLabel)}/${day} of ${year} reads "${raw}"`);
        }

        if (value.isNegative() || value.greaterThan(MAX_PLAUSIBLE_VALUE)) {
          fail(
            `cell ${date.toString()} reads ${value.toString()}, outside 0–${MAX_PLAUSIBLE_VALUE.amount.toFixed(0)} zł per bond`,
          );
        }
        cells.push([date, value]);
      });
    }
  }

  return cells.sort(([a], [b]) => Temporal.PlainDate.compare(a, b));
}

/**
 * Turn one payload into a `BondInterestTable`, or refuse it.
 *
 * Everything asserted here was verified against the live API before it was
 * written, not assumed: the first cell always falls on `interestFrom`, the last
 * on `interestTo`, there is exactly one cell per calendar day between them, and
 * the values never decrease. A payload that breaks any of those is one this
 * adapter has misunderstood, and a misunderstood table is worse than no table —
 * the caller has a validated engine to fall back on (rule 7).
 */
export function parseInterestTable(
  payload: string,
  requested: BondInterestTableKey,
  requestedSeries?: BondSeriesCode,
): BondInterestTable {
  const document = JSON.parse(payload) as RawTableDocument;
  const series = isString(document.series) ? document.series : '';
  const label = `${requested.periodOrdinal}-${requested.purchaseDayKey}`;
  const fail = (detail: string): never => {
    throw new UnreadableInterestTableError(series || '(unnamed series)', label, detail);
  };

  if (!isString(document.interestFrom) || !isString(document.interestTo)) {
    fail('the payload carries no interest period dates');
  }
  if (!isString(document.interestRatePercentage)) fail('the payload carries no interest rate');

  let startsOn: Temporal.PlainDate;
  let endsOn: Temporal.PlainDate;
  let annualRate: Decimal;
  let seriesCode: BondSeriesCode;
  try {
    startsOn = toPlainDate(document.interestFrom as string);
    endsOn = toPlainDate(document.interestTo as string);
    annualRate = toDecimal(document.interestRatePercentage as string).dividedBy(100);
    seriesCode = parseSeriesCode(series).code;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  if (annualRate.isNegative() || annualRate.greaterThan(MAX_PLAUSIBLE_RATE)) {
    fail(`the rate ${annualRate.times(100).toFixed(2)}% is outside the plausible band (0–25%)`);
  }

  const cells = datedCells(document, fail);
  const span = startsOn.until(endsOn).days;
  if (cells.length !== span + 1) {
    fail(`${cells.length} dated values for a period of ${span + 1} days`);
  }

  const dailyValues: Money[] = [];
  cells.forEach(([date, value], offset) => {
    const expected = startsOn.add({ days: offset });
    if (Temporal.PlainDate.compare(date, expected) !== 0) {
      fail(`a gap in the grid — ${expected.toString()} has no value`);
    }
    const previous = dailyValues.at(-1);
    if (previous !== undefined && value.lessThan(previous)) {
      fail(
        `accrued interest falls from ${previous.toString()} to ${value.toString()} on ${date.toString()}`,
      );
    }
    dailyValues.push(value);
  });

  // The payload repeats the key it was asked for, and it is checked rather than
  // either trusted or ignored. Trusting the echo files the table under whatever
  // the agent says; ignoring it files a table fetched for one period under
  // another, and `readInterestTable`'s span check only catches the mispairings
  // whose spans happen to differ. These two fields are the only ones that can
  // tell, so they are asserted.
  if (requestedSeries !== undefined && seriesCode !== requestedSeries) {
    // The series is asserted for the same reason the period is: this row is
    // upserted under whatever code comes back, so a payload for another series
    // would overwrite that series' legitimate table with figures fetched for a
    // different one. Optional only because the pure parser is also exercised
    // without a request behind it.
    fail(`the payload is series ${seriesCode}, which is not what was asked for`);
  }

  if (
    document.interestPeriodNumber !== requested.periodOrdinal ||
    document.interestPeriodDay !== requested.purchaseDayKey
  ) {
    fail(
      `the payload is period ${String(document.interestPeriodNumber)}-${String(document.interestPeriodDay)}, which is not what was asked for`,
    );
  }

  return {
    seriesCode,
    periodOrdinal: requested.periodOrdinal,
    purchaseDayKey: requested.purchaseDayKey,
    startsOn,
    endsOn,
    annualRate,
    source: 'pekao',
    dailyValues,
  };
}

/** `{ "12-31": "30.06.2026 - 31.07.2026" }` → the keys we can ask for. */
export function parsePublishedTables(payload: string): readonly BondInterestTableKey[] {
  const document = JSON.parse(payload) as Record<string, unknown>;
  const keys: BondInterestTableKey[] = [];

  for (const key of Object.keys(document)) {
    const match = /^(\d+)-(\d+)$/.exec(key);
    if (match === null) continue;
    const periodOrdinal = Number.parseInt(match[1]!, 10);
    const purchaseDay = Number.parseInt(match[2]!, 10);
    // Anything outside the four published purchase days is a key shape this
    // adapter does not model; skipping it is safe because a table we never ask
    // for simply sends the caller to the engine.
    if (purchaseDay !== 1 && purchaseDay !== 29 && purchaseDay !== 30 && purchaseDay !== 31) {
      continue;
    }
    if (!Number.isInteger(periodOrdinal) || periodOrdinal < 1) continue;
    keys.push({ periodOrdinal, purchaseDayKey: purchaseDay as PurchaseDayKey });
  }

  return keys.sort((a, b) => a.periodOrdinal - b.periodOrdinal);
}

async function getText(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  // A series or period the agent does not publish answers 404; that is a
  // boundary of the source, not an error to propagate.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Pekao answered ${response.status} for ${url}`);
  }
  return await response.text();
}

export const pekaoInterestTableProvider: BondInterestTableProvider = {
  name: 'pekao',

  async fetchPublishedTables(code: BondSeriesCode) {
    const payload = await getText(`${BASE_URL}/emissions/${code}`);
    if (payload === null) return [];
    return parsePublishedTables(payload);
  },

  async fetchTable(code: BondSeriesCode, key: BondInterestTableKey) {
    const label = `${key.periodOrdinal}-${key.purchaseDayKey}`;
    const payload = await getText(`${BASE_URL}/emissions/${code}/${label}`);
    if (payload === null) return null;
    return parseInterestTable(payload, key, code);
  },
};

/** Exposed for the caller that needs to know which table a lot reads. */
export { interestTableKeyFor };
