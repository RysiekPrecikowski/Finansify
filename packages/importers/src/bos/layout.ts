/**
 * DM BOŚ's "historia finansowa" export: a single CSV, `windows-1250`-encoded,
 * `;`-delimited, five columns, one header row, no quoting anywhere in two
 * real accounts examined (an IKZE and a brokerage account, both PLN/EUR/USD
 * across 2020–2026) — every field is safe to split on `;` with no CSV-quoting
 * library. Node's built-in `TextDecoder` supports `windows-1250` directly, so
 * no new dependency is needed to read it.
 */
export const BOS_HEADER = 'data;tytuł operacji;szczegóły;kwota;waluta';

export function decodeBos(bytes: Uint8Array): string {
  return new TextDecoder('windows-1250').decode(bytes);
}

/** Every non-empty line after the header — a real export ends with a trailing newline, never a blank data row. */
export function bosDataLines(text: string): readonly string[] {
  const lines = text.split('\n');
  const [, ...rest] = lines;
  return rest.map((line) => line.trimEnd()).filter((line) => line.length > 0);
}
