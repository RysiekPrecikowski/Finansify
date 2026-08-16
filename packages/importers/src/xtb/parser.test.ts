import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { currency, type ParsedRow, type RawFile } from '@finansify/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { xtbStatementParser } from './parser';

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixture/xtb-sample.xlsx',
);

function readFixtureFile(): RawFile {
  return { filename: 'xtb-sample.xlsx', bytes: new Uint8Array(readFileSync(FIXTURE_PATH)) };
}

function findRow(rows: readonly ParsedRow[], externalId: string): ParsedRow {
  const found = rows.find((row) => row.externalId === externalId);
  if (found === undefined) {
    throw new Error(`expected a parsed row with externalId "${externalId}"`);
  }
  return found;
}

describe('xtbStatementParser.sniff', () => {
  it('returns certain for the real fixture', async () => {
    expect(await xtbStatementParser.sniff(readFixtureFile())).toBe('certain');
  });

  it('returns none for bytes that are not a readable xlsx at all', async () => {
    const file: RawFile = { filename: 'bogus.xlsx', bytes: new Uint8Array([1, 2, 3]) };

    expect(await xtbStatementParser.sniff(file)).toBe('none');
  });

  it('returns none for a valid xlsx with unrelated sheets', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Unrelated Sheet');
    const buffer = await workbook.xlsx.writeBuffer();
    const file: RawFile = { filename: 'other.xlsx', bytes: new Uint8Array(buffer) };

    expect(await xtbStatementParser.sniff(file)).toBe('none');
  });
});

describe('xtbStatementParser.parse — against the real fixture', () => {
  let rows: readonly ParsedRow[];
  let statementWarnings: readonly string[];

  beforeAll(async () => {
    const result = await xtbStatementParser.parse(readFixtureFile());
    rows = result.rows;
    statementWarnings = result.warnings;
  });

  it('returns exactly the rows the fixture’s own cash operations produce, plus the recovered SPIN.PL row', () => {
    // 24 Cash Operations data rows in fixture/generate.ts, minus 4 zero-sum
    // transfer rows (ST1, ST2, TR1, TR2) and 3 zero-amount unrecognized rows
    // tied to the SPLT.PL split cluster (C1, CR1, CT1) = 17, plus one row
    // recovered from Open Positions for SPIN.PL, which has zero Cash
    // Operations rows at all = 18.
    expect(rows).toHaveLength(18);
  });

  it('reports no statement-level warnings — every Open Positions ticker has a cash row', () => {
    expect(statementWarnings).toEqual([]);
  });

  it('parses ETFX.PL rows with no warnings and a null fxRate (same-currency ticker)', () => {
    for (const id of ['T1', 'T2', 'T3', 'T4', 'DIV1', 'WHT1']) {
      const row = findRow(rows, id);
      expect(row.warnings, `row ${id} should have no warnings`).toEqual([]);
      expect(row.fxRate, `row ${id} should have a null fxRate`).toBeNull();
    }
  });

  it('derives ETFX.PL trade quantities and prices from the comment grammar', () => {
    const t1 = findRow(rows, 'T1');
    expect(t1.type).toBe('buy');
    expect(t1.quantity.toString()).toBe('10');
    expect(t1.price?.toString()).toBe('50 PLN');

    const t2 = findRow(rows, 'T2'); // split fill "2/7.5" — quantity is 2, not 7.5
    expect(t2.quantity.toString()).toBe('2');

    const t4 = findRow(rows, 'T4');
    expect(t4.type).toBe('sell');
    expect(t4.quantity.toString()).toBe('3');
  });

  it('parses FORX.US rows with a non-null fxRate and a warning mentioning FX', () => {
    for (const id of ['T5', 'T6']) {
      const row = findRow(rows, id);
      expect(row.fxRate, `row ${id} should have an inferred fxRate`).not.toBeNull();
      expect(row.fxRate?.toString()).toBe('0.92');
      expect(row.fxRateSource).toBe('broker');
      expect(
        row.warnings.some((w) => /FX/.test(w)),
        `row ${id} should warn about FX`,
      ).toBe(true);
    }
  });

  it('imports SPLT.PL’s Fractional shares row as a sell with a quantity-unknown warning', () => {
    const fs1 = findRow(rows, 'FS1');
    expect(fs1.type).toBe('sell'); // positive amount
    expect(fs1.quantity.toString()).toBe('0'); // never guessed
    expect(fs1.instrument?.symbol).toBe('SPLT.WA');
    expect(fs1.warnings).toHaveLength(1);
    expect(fs1.warnings[0]).toContain('SPLT.PL split 2 for 1');
    expect(fs1.warnings[0]).toMatch(/quantity|fraction/i);
  });

  it('normalizes every ticker to market-symbol form on the parsed rows', () => {
    expect(findRow(rows, 'T1').instrument?.symbol).toBe('ETFX.WA'); // .PL -> .WA
    expect(findRow(rows, 'T5').instrument?.symbol).toBe('FORX'); // .US suffix dropped
    expect(findRow(rows, 'FS1').instrument?.symbol).toBe('SPLT.WA');
    expect(findRow(rows, 'T7').instrument?.symbol).toBe('MISM.WA');
    expect(findRow(rows, 'T8').instrument?.symbol).toBe('LOST.WA');
  });

  it('drops the zero-amount Commission/Correction/Close trade rows for the SPLT.PL cluster', () => {
    for (const id of ['C1', 'CR1', 'CT1']) {
      expect(
        rows.some((row) => row.externalId === id),
        `row ${id} should be absent`,
      ).toBe(false);
    }
  });

  it('attaches the reconciliation-mismatch warning to MISM.PL’s row, keyed by its normalized ticker', () => {
    const t7 = findRow(rows, 'T7');
    expect(t7.warnings).toHaveLength(1);
    expect(t7.warnings[0]).toMatch(/Reconciliation mismatch/);
    // The warning is built from row.instrument.symbol, which is normalized —
    // MISM.PL's Cash Operations ticker and Open Positions ticker both go
    // through normalizeXtbTicker, so the reconciliation join (and this
    // message) uses MISM.WA, never the raw MISM.PL.
    expect(t7.warnings[0]).toContain('MISM.WA');
    expect(t7.warnings[0]).not.toContain('MISM.PL');
  });

  it('attaches the missing-position warning to LOST.PL’s row, keyed by its normalized ticker', () => {
    const t8 = findRow(rows, 'T8');
    expect(t8.warnings).toHaveLength(1);
    expect(t8.warnings[0]).toMatch(/no counterpart/);
    expect(t8.warnings[0]).toContain('LOST.WA');
    expect(t8.warnings[0]).not.toContain('LOST.PL');
  });

  it('recovers SPIN.PL as a transfer_in row from Open Positions’ own lot, since Cash Operations has nothing for it at all', () => {
    const spin = findRow(rows, 'xtb-position:1000000009');

    expect(spin.type).toBe('transfer_in');
    expect(spin.instrument?.symbol).toBe('SPIN.WA'); // .PL -> .WA, same normalization as every other row
    expect(spin.quantity.toString()).toBe('8');
    expect(spin.price?.toString()).toBe('0.01 PLN');
    expect(spin.grossAmount?.toString()).toBe('0.08 PLN');
    expect(spin.currency).toBe(currency('PLN'));
    expect(spin.warnings).toHaveLength(1);
    expect(spin.warnings[0]).toMatch(/Open Positions/);
    expect(spin.warnings[0]).toMatch(/Cash Operations/);
  });

  it('does not produce the old statement-level "no buy/sell row for it at all" warning for SPIN.PL, since it now reconciles', () => {
    // The recovered transfer_in row's quantity (8) matches SPIN.PL's own
    // Open Positions aggregate (8) exactly, so it reconciles cleanly —
    // proven by the blanket "no statement-level warnings" assertion above,
    // and reasserted here by name so a future regression names the ticker.
    expect(statementWarnings.some((w) => w.includes('SPIN'))).toBe(false);
  });

  it('never produces a row for the Cash Operations "Total" or Closed Positions "Profit/loss" footer', () => {
    // Neither footer row carries a broker row id at all, so there is no
    // externalId to look for — the exact row count (17) already proves
    // neither footer contributed a row; this asserts no row has an empty or
    // undefined-looking externalId as an extra guard.
    expect(rows.every((row) => row.externalId.length > 0)).toBe(true);
  });

  it('resolves the account currency from the Open Positions summary block', () => {
    for (const row of rows) {
      expect(row.currency).toBe(currency('PLN'));
    }
  });
});

describe('xtbStatementParser.parse — the account currency is never guessed', () => {
  /** The fixture, with the `Open Positions` summary block's `Currency` cell rewritten. */
  async function fixtureWithSummaryCurrency(value: string | null): Promise<RawFile> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readFileSync(FIXTURE_PATH) as never);
    workbook.getWorksheet('Open Positions')!.getRow(5).getCell(4).value = value;
    const buffer = await workbook.xlsx.writeBuffer();
    return { filename: 'xtb-sample.xlsx', bytes: new Uint8Array(buffer) };
  }

  it('reads a non-PLN account currency straight from the sheet', async () => {
    const { rows } = await xtbStatementParser.parse(await fixtureWithSummaryCurrency('USD'));

    expect(rows.every((row) => row.currency === currency('USD'))).toBe(true);
  });

  /**
   * The regression this describe block exists for. An account with nothing
   * currently open has no summary block to read, and defaulting to PLN there
   * relabelled every amount in a USD or EUR statement with no warning
   * anywhere — a wrong currency on real money that looks exactly like a right
   * one. Refusing the statement outright is what `makeUploadStatement` turns
   * into a `failed` batch the user can act on.
   */
  it('refuses the statement when the summary block carries no currency', async () => {
    await expect(xtbStatementParser.parse(await fixtureWithSummaryCurrency(null))).rejects.toThrow(
      /no readable account currency/,
    );
  });

  it('refuses the statement when the currency cell is not an ISO 4217 code', async () => {
    await expect(
      xtbStatementParser.parse(await fixtureWithSummaryCurrency('Currency')),
    ).rejects.toThrow(/no readable account currency/);
  });
});
