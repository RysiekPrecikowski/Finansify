import { Temporal, type IndexObservation, type IndexObservationProvider } from '@finansify/core';
import Decimal from 'decimal.js';

/**
 * Polish CPI year-on-year, which COI, ROS, EDO and ROD index against.
 *
 * **Not** from the BDL API, which publishes CPI only annually and quarterly —
 * every CPI subject is marked `R` or `K`, never `M`. GUS's newer DBW API has no
 * consumer-price area at all. This CSV is the only free monthly source, and it
 * carries the whole series back to 1982-01 in one GET. See ADR 0015.
 */
const CPI_CSV_URL =
  'https://stat.gov.pl/download/gfx/portalinformacyjny/pl/defaultstronaopisowa/4741/1/1/miesieczne_wskazniki_cen_towarow_i_uslug_konsumpcyjnych_od_1982_roku__2_2.csv';

/**
 * The file is Windows-1250, semicolon-delimited, with comma decimals — read as
 * UTF-8 it mangles every Polish character in the column we filter on, so the
 * filter would silently match nothing and the series would come back empty.
 */
const ENCODING = 'windows-1250';
const DELIMITER = ';';

/** The presentation we want. Four others share the file; matching loosely picks up the wrong series. */
const YEAR_ON_YEAR = 'Analogiczny miesiąc poprzedniego roku = 100';

const COLUMN = { presentation: 2, year: 3, month: 4, value: 5 } as const;

/**
 * Poland's post-1989 inflation peaked around 640% year-on-year in 1990 and the
 * series has dipped below 100 (deflation) more than once, so the plausible band
 * has to be wide on one side and admit sub-100 on the other. An index of 0 or a
 * negative one means the column moved — refuse rather than write it. A wrong
 * CPI print silently mis-values every indexed bond for its whole term.
 */
const MIN_INDEX = new Decimal('50');
const MAX_INDEX = new Decimal('1000');

export class ImplausibleCpiError extends Error {
  constructor(raw: string, year: string, month: string) {
    super(
      `CPI index "${raw}" for ${year}-${month} is outside the plausible band (50–1000) — refusing to write it`,
    );
    this.name = 'ImplausibleCpiError';
  }
}

/**
 * A minimal splitter rather than a CSV dependency: this file has no quoted
 * fields and no embedded delimiters, verified across all 2185 rows. If GUS ever
 * starts quoting, the presentation filter stops matching and the parser returns
 * nothing, which fails loudly instead of producing subtly wrong rows.
 */
function rows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(DELIMITER));
}

/**
 * GUS publishes the figure as an index where the same month a year earlier is
 * 100. The domain wants a rate, so 103.0 becomes 0.03 — and a deflationary
 * 99.2 becomes -0.008, which the accrual engine floors at zero for the bond
 * families whose terms say so. The flooring belongs there, not here: this
 * adapter reports what GUS published.
 */
function toRate(index: Decimal): Decimal {
  return index.minus(100).dividedBy(100);
}

export function parseCpiCsv(text: string): readonly IndexObservation[] {
  const observations: IndexObservation[] = [];

  for (const row of rows(text).slice(1)) {
    if (row.length <= COLUMN.value) continue;
    if (row[COLUMN.presentation]?.trim() !== YEAR_ON_YEAR) continue;

    const year = row[COLUMN.year]?.trim() ?? '';
    const month = row[COLUMN.month]?.trim() ?? '';
    const raw = row[COLUMN.value]?.trim() ?? '';

    // Months of the current year that have not been published yet are present
    // as blank cells. Skipping them is the whole point — parsed as a number a
    // blank is zero, which would read as 100% deflation.
    if (raw === '' || year === '' || month === '') continue;

    // `Decimal` throws its own error on junk; it becomes our error so a caller
    // has one type to catch and the message names the offending cell. Refusing
    // is the point — a value we cannot read must never be skipped in silence.
    let index: Decimal;
    try {
      index = new Decimal(raw.replace(',', '.'));
    } catch {
      throw new ImplausibleCpiError(raw, year, month);
    }
    if (!index.isFinite() || index.lessThan(MIN_INDEX) || index.greaterThan(MAX_INDEX)) {
      throw new ImplausibleCpiError(raw, year, month);
    }

    // `PlainYearMonth.from` rejects a malformed month without any hand-rolled
    // range check, and pads the single-digit months GUS writes unpadded.
    const referenceMonth = Temporal.PlainYearMonth.from(`${year}-${month.padStart(2, '0')}`);

    observations.push({
      indexId: 'pl_cpi_yoy',
      // Dated by **announcement**, not by the month described: GUS publishes a
      // month's figure during the following month, and the indexed families use
      // "the print announced in the month preceding the interest period". Dating
      // it this way turns that rule into a plain `effectiveFrom < periodStart`.
      effectiveFrom: referenceMonth.add({ months: 1 }).toPlainDate({ day: 1 }),
      value: toRate(index),
    });
  }

  return observations.sort((a, b) => Temporal.PlainDate.compare(a.effectiveFrom, b.effectiveFrom));
}

export const gusCpiProvider: IndexObservationProvider = {
  name: 'gus',
  indexId: 'pl_cpi_yoy',

  async fetchObservations(): Promise<readonly IndexObservation[]> {
    const response = await fetch(CPI_CSV_URL);
    if (!response.ok) throw new Error(`GUS responded with ${response.status}`);

    const text = new TextDecoder(ENCODING).decode(await response.arrayBuffer());
    const observations = parseCpiCsv(text);
    if (observations.length === 0) {
      throw new Error(
        `GUS CSV yielded no "${YEAR_ON_YEAR}" rows — the file's shape changed; refusing to report an empty series`,
      );
    }
    return observations;
  },
};
