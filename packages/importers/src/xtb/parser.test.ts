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

  it('returns exactly the rows the fixture’s own cash operations produce', () => {
    // 24 Cash Operations data rows in fixture/generate.ts, minus 4 zero-sum
    // transfer rows (ST1, ST2, TR1, TR2) and 3 zero-amount unrecognized rows
    // tied to the SPLT.PL split cluster (C1, CR1, CT1) = 17.
    expect(rows).toHaveLength(17);
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

  it('imports SPLT.PL’s Fractional shares row as a dividend with a warning', () => {
    const fs1 = findRow(rows, 'FS1');
    expect(fs1.type).toBe('dividend');
    expect(fs1.warnings).toHaveLength(1);
    expect(fs1.warnings[0]).toContain('Fractional shares');
  });

  it('drops the zero-amount Commission/Correction/Close trade rows for the SPLT.PL cluster', () => {
    for (const id of ['C1', 'CR1', 'CT1']) {
      expect(
        rows.some((row) => row.externalId === id),
        `row ${id} should be absent`,
      ).toBe(false);
    }
  });

  it('attaches the reconciliation-mismatch warning to MISM.PL’s row', () => {
    const t7 = findRow(rows, 'T7');
    expect(t7.warnings).toHaveLength(1);
    expect(t7.warnings[0]).toMatch(/Reconciliation mismatch/);
    expect(t7.warnings[0]).toContain('MISM.PL');
  });

  it('attaches the missing-position warning to LOST.PL’s row', () => {
    const t8 = findRow(rows, 'T8');
    expect(t8.warnings).toHaveLength(1);
    expect(t8.warnings[0]).toMatch(/no counterpart/);
    expect(t8.warnings[0]).toContain('LOST.PL');
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
