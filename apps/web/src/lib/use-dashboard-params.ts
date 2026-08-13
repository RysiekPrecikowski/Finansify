'use client';

import { useSearchParams } from 'next/navigation';

import { parseDashboardParams, type DashboardParams } from './dashboard-params';

/**
 * The **live** dashboard params, not the server's snapshot of them.
 *
 * The chart range switches on the client and writes the URL back with
 * `history.replaceState`, which Next integrates into its router — so this hook
 * sees the new range without a server render. Every control that builds a link
 * must read from here rather than take a server-computed href as a prop: a href
 * baked at render time still carries whatever the range was *then*, and
 * clicking it silently drops the one the user picked since.
 *
 * The rule this enforces: on the dashboard, hrefs are derived from the live
 * params by whoever renders them, never passed down.
 */
export function useDashboardParams(): DashboardParams {
  return parseDashboardParams(Object.fromEntries(useSearchParams().entries()));
}
