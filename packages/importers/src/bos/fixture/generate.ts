/**
 * Builds `bos-sample.csv` from scratch — every value here is invented, never
 * copied from a real export (real exports are gitignored under `__private/`
 * and never committed, even in part). Structurally it matches a real DM BOŚ
 * "historia finansowa" export exactly (header, `;` delimiter, `windows-1250`
 * encoding, comma-decimal `kwota`, dot-decimal price embedded in
 * `szczegóły`), confirmed against two real accounts (an IKZE and a
 * brokerage account) during planning; the numbers are fiction designed to
 * exercise every case the parser has to handle:
 *
 * - A PLN deposit (`Przelew do DM BOŚ`), plus a second, identical one on the
 *   same day — the real, verified reason `external-id.ts` disambiguates by
 *   occurrence rather than trusting content alone to be unique.
 * - A clean EUR buy (`Rozliczenie transakcji kupna:`) whose settled amount
 *   equals quantity × price exactly — no implied-commission warning.
 * - A second EUR buy whose settled amount is a few cents higher than
 *   quantity × price — the implied-commission warning, the real shape a
 *   commission takes in this export (netted into `kwota`, never broken out).
 * - A PLN→EUR currency exchange, as its two real legs: one negative PLN row,
 *   one positive EUR row, same date, same title.
 * - A USD dividend whose title carries a trailing currency qualifier
 *   (`Wypłata dywidendy brutto VWRL EUR` paid out in USD — confirmed against
 *   a real account: the qualifier names the fund's listing currency, not
 *   the currency the cash actually arrived in).
 * - A PLN dividend whose title carries no qualifier at all
 *   (`Wypłata dywidendy brutto ETFSP500`) — the domestic-listing case.
 * - An unrecognized operation title, to exercise the sign-guessed fallback
 *   and its warning (no real export has shown one, but `parse()` must never
 *   throw on it either).
 * - A buy row whose `szczegóły` doesn't match the known grammar at all — the
 *   "could not parse" fallback, cash-only with a warning.
 *
 * Run with `pnpm --filter @finansify/importers fixture:generate:bos`.
 * Regenerate whenever the fixture needs a new case; do not hand-edit the
 * `.csv` file directly (it is `windows-1250`-encoded, so a plain editor save
 * would silently re-encode it as UTF-8 and break `sniff()`'s own fixture use).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

import { BOS_HEADER } from '../layout';

const ROW_LINES = [
  '2026-01-05;Przelew do DM BOŚ;;5000,00;PLN',
  '2026-01-05;Przelew do DM BOŚ;;5000,00;PLN',
  '2026-01-10;Rozliczenie transakcji kupna:;Vanguard FTSE All-World UCITS ETF (IE00B3RBWM25) 10 x 100.00 EUR nr Z00000000001;-1000,00;EUR',
  '2026-01-15;Rozliczenie transakcji kupna:;Vanguard FTSE All-World UCITS ETF (IE00B3RBWM25) 5 x 100.00 EUR nr Z00000000002;-502,50;EUR',
  '2026-01-20;Wymiana waluty PLN/EUR 4.3000;;-4300,00;PLN',
  '2026-01-20;Wymiana waluty PLN/EUR 4.3000;;1000,00;EUR',
  '2026-02-01;Wypłata dywidendy brutto VWRL EUR;;12,50;USD',
  '2026-02-05;Wypłata dywidendy brutto ETFSP500;;30,00;PLN',
  '2026-02-10;Odsetki od środków pieniężnych;;4,20;PLN',
  '2026-02-15;Rozliczenie transakcji kupna:;coś nietypowego, nie pasuje do wzorca;-100,00;PLN',
].join('\n');

const CSV_TEXT = `${BOS_HEADER}\n${ROW_LINES}\n`;

function main() {
  // `windows-1250` isn't one of Node's Buffer built-in encodings, so the
  // fixture is built as a codepoint-by-codepoint cp1250 map rather than
  // trusting a library encoder to exist — the only non-ASCII codepoints this
  // fixture actually uses are the ones the header and Polish words need.
  const CP1250: Record<string, number> = {
    ą: 0xb9,
    ć: 0xe6,
    ę: 0xea,
    ł: 0xb3,
    ń: 0xf1,
    ó: 0xf3,
    ś: 0x9c,
    ź: 0x9f,
    ż: 0xbf,
    Ą: 0xa5,
    Ć: 0xc6,
    Ę: 0xca,
    Ł: 0xa3,
    Ń: 0xd1,
    Ó: 0xd3,
    Ś: 0x8c,
    Ź: 0x8f,
    Ż: 0xaf,
  };

  const out: number[] = [];
  for (const char of CSV_TEXT) {
    const mapped = CP1250[char];
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code > 0x7f) {
      throw new Error(
        `No cp1250 mapping for character ${JSON.stringify(char)} (U+${code.toString(16)})`,
      );
    }
    out.push(code);
  }

  const outPath = path.join(fileURLToPath(new URL('.', import.meta.url)), 'bos-sample.csv');
  writeFileSync(outPath, Uint8Array.from(out));
  // A one-off script's status line, not application logging — `console.warn`
  // matches xtb/fixture/generate.ts's own convention for the same reason.
  console.warn(`Wrote ${outPath} (${out.length} bytes)`);
}

main();
