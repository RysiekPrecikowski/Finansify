/**
 * Golden data: the Ministry's own published interest table for **ROR0827
 * purchased on 2026-08-31**, first interest period, 4.00% annualized.
 *
 * Source: `obligacjeskarbowe.pl/tabela-odsetkowa/`, PDF titled
 * "TABELA ODSETKOWA — Roczne oszczędnościowe obligacje skarbowe o
 * oprocentowaniu zmiennym / ROR0827 / NABYTYCH W DNIU 2026-08-31", issued
 * Warszawa 2026-07-28. Values are złote of interest per **one** 100 zł bond.
 *
 * Transcribed by hand rather than parsed: the tables sit behind a POST form
 * that PKO's WAF answers with 403 for every non-interactive client — verified
 * with a real headless Chromium, not only with curl. See ADR 0016.
 *
 * This fixture is the reason the day-count rule in `accrue-bond.ts` is what it
 * is. ACT/365 disagrees with it on 7 of these 30 days and ACT/366 on 8; only
 * "a twelfth of the annual rate, spread across the period's own day count"
 * reproduces all 30. Anyone tempted to simplify that should change this file
 * first and watch it fail.
 */
export const ror0827Period1 = {
  seriesCode: 'ROR0827',
  settledOn: '2026-08-31',
  annualRate: '0.04',
  periodStartsOn: '2026-08-31',
  periodEndsOn: '2026-09-30',
  /** `[date, accrued interest on one bond]`, every published day of the table. */
  accruedByDate: [
    ['2026-08-31', '0.00'],
    ['2026-09-01', '0.01'],
    ['2026-09-02', '0.02'],
    ['2026-09-03', '0.03'],
    ['2026-09-04', '0.04'],
    ['2026-09-05', '0.06'],
    ['2026-09-06', '0.07'],
    ['2026-09-07', '0.08'],
    ['2026-09-08', '0.09'],
    ['2026-09-09', '0.10'],
    ['2026-09-10', '0.11'],
    ['2026-09-11', '0.12'],
    ['2026-09-12', '0.13'],
    ['2026-09-13', '0.14'],
    ['2026-09-14', '0.16'],
    ['2026-09-15', '0.17'],
    ['2026-09-16', '0.18'],
    ['2026-09-17', '0.19'],
    ['2026-09-18', '0.20'],
    ['2026-09-19', '0.21'],
    ['2026-09-20', '0.22'],
    ['2026-09-21', '0.23'],
    ['2026-09-22', '0.24'],
    ['2026-09-23', '0.26'],
    ['2026-09-24', '0.27'],
    ['2026-09-25', '0.28'],
    ['2026-09-26', '0.29'],
    ['2026-09-27', '0.30'],
    ['2026-09-28', '0.31'],
    ['2026-09-29', '0.32'],
    ['2026-09-30', '0.33'],
  ] as const satisfies readonly (readonly [string, string])[],
} as const;
