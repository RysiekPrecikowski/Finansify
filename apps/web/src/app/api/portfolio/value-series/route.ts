import { currency as toCurrency } from '@finansify/core';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth';
import { getDisplaySettings } from '@/lib/display/server';
import { parseSeriesParams } from '@/lib/value-series-params';
import { readValueSeries, refreshValueSeries, type ValueSeriesResult } from '@/server/value-series';

function toResponseBody(result: ValueSeriesResult) {
  return {
    currency: result.currency,
    grain: result.grain,
    pending: result.pending,
    error: result.error,
    points: result.points.map((point) => ({
      date: point.date.toString(),
      // A decimal string, not a float: formatting happens on the client with
      // `Intl.NumberFormat`, never here (`apps/web/AGENTS.md`, "Presentation").
      value: point.value.amount.toFixed(2),
      status: point.status,
      unpriced: point.unpriced,
    })),
  };
}

/**
 * The hero chart's data source (CU-869ej7zk8). `GET ?range=&grain=&refresh=`.
 * No `refresh` (or `refresh` not exactly `1`) reads storage only — safe to
 * call on every render; `refresh=1` runs one bounded backfill round first.
 * Per-user data, so no caching headers: the presentation currency and the
 * ledger both vary by reader.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (user === null) return new NextResponse(null, { status: 401 });

  const { range, grain, refresh } = parseSeriesParams(new URL(request.url).searchParams);
  const display = await getDisplaySettings();

  const params = { range, grain, presentIn: toCurrency(display.total) };
  const result = refresh
    ? await refreshValueSeries(user.id, params)
    : await readValueSeries(user.id, params);

  return NextResponse.json(toResponseBody(result));
}
