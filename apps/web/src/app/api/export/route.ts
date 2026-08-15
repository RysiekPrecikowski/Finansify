import { makeExportLedger } from '@finansify/core';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth';
import { toCsv, toJson } from '@/lib/ledger-export';
import { getInstruments, scopedLedgerFor } from '@/server/container';

const formats = ['csv', 'json'] as const;
type Format = (typeof formats)[number];

function isFormat(value: string | null): value is Format {
  return formats.includes(value as Format);
}

/**
 * The full ledger as a file download — Phase 1's "Export" (`docs/roadmap.md`).
 * `?format=csv` (default) or `?format=json`. A plain `<a download>` reaches
 * this, not a client fetch, so the browser's own download handling applies —
 * no client-side blob juggling needed.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (user === null) return new NextResponse(null, { status: 401 });

  const requested = new URL(request.url).searchParams.get('format');
  const format: Format = isFormat(requested) ? requested : 'csv';

  const exportLedger = makeExportLedger({
    ledger: scopedLedgerFor(user.id),
    instruments: getInstruments(),
  });
  const rows = await exportLedger();

  const body = format === 'csv' ? toCsv(rows) : toJson(rows);
  const contentType =
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="finansify-ledger-${date}.${format}"`,
    },
  });
}
