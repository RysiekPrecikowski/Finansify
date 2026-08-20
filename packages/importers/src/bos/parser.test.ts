import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RawFile } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { BOS_HEADER } from './layout';
import { bosStatementParser } from './parser';

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixture/bos-sample.csv',
);

function readFixtureFile(): RawFile {
  return { filename: 'bos-sample.csv', bytes: new Uint8Array(readFileSync(FIXTURE_PATH)) };
}

/**
 * Plain UTF-8 encoding — wrong on purpose for anything containing the header's
 * own Polish diacritics (`ł`, `ó`, `ś`), since `decodeBos` reads bytes as
 * windows-1250. That mismatch is harmless for the "wrong header" tests below:
 * they only need `decodeBos(bytes) !== BOS_HEADER`, which garbled diacritics
 * still satisfy. Only the "real header" tests need bytes windows-1250 decodes
 * back to the exact header string, so those use `encodeBos` instead.
 */
function fileFromText(text: string): RawFile {
  return { filename: 'statement.csv', bytes: new TextEncoder().encode(text) };
}

/**
 * The inverse of `decodeBos`, for the small set of Polish diacritics
 * `BOS_HEADER` itself uses — same codepoint map `fixture/generate.ts` uses to
 * build the committed fixture, kept local to this test rather than imported
 * since it exists only to construct header bytes for `sniff()` assertions.
 */
const CP1250: Record<string, number> = { ł: 0xb3, ó: 0xf3, ś: 0x9c };

function encodeBos(text: string): RawFile {
  const bytes = Uint8Array.from(text, (char) => {
    const mapped = CP1250[char];
    if (mapped !== undefined) return mapped;
    const code = char.codePointAt(0)!;
    if (code > 0x7f) throw new Error(`encodeBos has no cp1250 mapping for ${JSON.stringify(char)}`);
    return code;
  });
  return { filename: 'statement.csv', bytes };
}

describe('bosStatementParser.sniff', () => {
  it('returns certain for the real header', async () => {
    expect(await bosStatementParser.sniff(encodeBos(`${BOS_HEADER}\n`))).toBe('certain');
  });

  it('returns certain for the real fixture file', async () => {
    expect(await bosStatementParser.sniff(readFixtureFile())).toBe('certain');
  });

  it('returns none for a wrong header', async () => {
    expect(
      await bosStatementParser.sniff(fileFromText('data;title;details;amount;currency\n')),
    ).toBe('none');
  });

  it('returns none for a header missing a column', async () => {
    expect(
      await bosStatementParser.sniff(fileFromText('data;tytuł operacji;szczegóły;kwota\n')),
    ).toBe('none');
  });

  it('returns none for an empty file', async () => {
    expect(await bosStatementParser.sniff(fileFromText(''))).toBe('none');
  });

  it('returns none for garbage bytes', async () => {
    const file: RawFile = { filename: 'garbage.csv', bytes: new Uint8Array([0, 1, 2, 255, 254]) };

    expect(await bosStatementParser.sniff(file)).toBe('none');
  });

  it('identifies itself as the "bos" broker', () => {
    expect(bosStatementParser.broker).toBe('bos');
  });
});

describe('bosStatementParser.parse — against the real fixture', () => {
  it('returns broker id "bos"', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());

    expect(result.broker).toBe('bos');
  });

  it('returns one row per fixture data line (10 rows: none are zero-amount)', async () => {
    // fixture/generate.ts lists 10 ROW_LINES, none with a zero amount, so
    // none are dropped by mapBosRow's zero-amount-returns-null rule.
    const result = await bosStatementParser.parse(readFixtureFile());

    expect(result.rows).toHaveLength(10);
  });

  it('reports no statement-level warnings', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());

    expect(result.warnings).toEqual([]);
  });

  it('maps the two identical same-day deposits to distinct externalIds', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());
    // Filtered by note (== the row's own title), not just type — the
    // unrecognized-title fallback row also lands as a positive-sign
    // 'deposit', so filtering on type alone would pick that one up too.
    const deposits = result.rows.filter((row) => row.note === 'Przelew do DM BOŚ');

    expect(deposits).toHaveLength(2);
    expect(deposits.every((row) => row.type === 'deposit')).toBe(true);
    expect(deposits[0]?.externalId).not.toBe(deposits[1]?.externalId);
  });

  it('gives every row a non-empty externalId', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());

    expect(result.rows.every((row) => row.externalId.length > 0)).toBe(true);
  });

  it('parses the clean EUR buy with no commission warning, and the second with one', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());
    const buys = result.rows.filter((row) => row.type === 'buy' && row.instrument !== null);

    expect(buys).toHaveLength(2);
    expect(buys[0]?.warnings).toEqual([]);
    expect(buys[1]?.warnings).toHaveLength(1);
    expect(buys[1]?.warnings[0]).toMatch(/commission/i);
  });

  it('parses the currency exchange as one transfer_out (PLN) and one transfer_in (EUR)', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());
    const transfersOut = result.rows.filter((row) => row.type === 'transfer_out');
    const transfersIn = result.rows.filter((row) => row.type === 'transfer_in');

    expect(transfersOut).toHaveLength(1);
    expect(transfersOut[0]?.currency).toBe('PLN');
    expect(transfersIn).toHaveLength(1);
    expect(transfersIn[0]?.currency).toBe('EUR');
  });

  it('parses both dividend rows', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());
    const dividends = result.rows.filter((row) => row.type === 'dividend');

    expect(dividends).toHaveLength(2);
    expect(dividends.map((row) => row.instrument?.symbol).sort()).toEqual(['ETFSP500', 'VWRL']);
  });

  it('imports the unrecognized-title row (positive amount) as a deposit with a warning', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());
    const unrecognized = result.rows.find((row) =>
      row.warnings.some((w) => w.includes('Odsetki od środków pieniężnych')),
    );

    expect(unrecognized).toBeDefined();
    expect(unrecognized?.type).toBe('deposit');
  });

  it('imports the unparseable-detail buy row as a cash-only buy with a warning', async () => {
    const result = await bosStatementParser.parse(readFixtureFile());
    const fallbackBuy = result.rows.find((row) =>
      row.warnings.some((w) => w.includes('Could not parse the trade detail')),
    );

    expect(fallbackBuy).toBeDefined();
    expect(fallbackBuy?.type).toBe('buy');
    expect(fallbackBuy?.instrument).toBeNull();
  });
});

describe('bosStatementParser.parse — defensive header check', () => {
  it('throws a clear error when the header does not match, even though sniff() should have refused it first', async () => {
    await expect(
      bosStatementParser.parse(fileFromText('data;title;details;amount;currency\nsomeline\n')),
    ).rejects.toThrow(/Unrecognized header/);
  });

  it('throws for an empty file', async () => {
    await expect(bosStatementParser.parse(fileFromText(''))).rejects.toThrow(/Unrecognized header/);
  });
});
