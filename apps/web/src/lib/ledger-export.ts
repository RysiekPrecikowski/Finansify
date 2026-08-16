import type { LedgerExportRow } from '@finansify/core';

/**
 * The full ledger, flattened to one row per transaction with its account and
 * instrument joined in — the "anti-lock-in" copy `docs/roadmap.md` promises
 * (Phase 1, "Export"). Deliberately raw, not `Intl`-formatted: a decimal stays
 * an exact string (`Decimal#toString()`), a date stays ISO
 * (`Temporal.PlainDate#toString()`) — this is a machine-readable interop
 * format, not a screen, so the locale-aware formatting in `lib/format.ts` does
 * not belong here.
 */
const COLUMNS = [
  'transactionId',
  'accountId',
  'accountName',
  'accountBroker',
  'accountWrapper',
  'accountCurrency',
  'instrumentId',
  'instrumentSymbol',
  'instrumentIsin',
  'instrumentExchange',
  'instrumentName',
  'instrumentKind',
  'type',
  'tradeDate',
  'settleDate',
  'quantity',
  'price',
  'grossAmount',
  'fee',
  'tax',
  'currency',
  'fxRate',
  'fxRateSource',
  'source',
  'externalId',
  'matchedLotIds',
  'note',
] as const;

type Column = (typeof COLUMNS)[number];
export type ExportRecord = Readonly<Record<Column, string | null>>;

export function toExportRecord(row: LedgerExportRow): ExportRecord {
  return {
    transactionId: row.transactionId,
    accountId: row.account.id,
    accountName: row.account.name,
    accountBroker: row.account.broker,
    accountWrapper: row.account.wrapper,
    accountCurrency: row.account.currency,
    instrumentId: row.instrument?.id ?? null,
    instrumentSymbol: row.instrument?.symbol ?? null,
    instrumentIsin: row.instrument?.isin ?? null,
    instrumentExchange: row.instrument?.exchange ?? null,
    instrumentName: row.instrument?.name ?? null,
    instrumentKind: row.instrument?.kind ?? null,
    type: row.type,
    tradeDate: row.tradeDate.toString(),
    settleDate: row.settleDate?.toString() ?? null,
    quantity: row.quantity.toString(),
    price: row.price?.amount.toString() ?? null,
    grossAmount: row.grossAmount?.amount.toString() ?? null,
    fee: row.fee.amount.toString(),
    tax: row.tax.amount.toString(),
    currency: row.currency,
    fxRate: row.fxRate?.toString() ?? null,
    fxRateSource: row.fxRateSource ?? null,
    source: row.source,
    externalId: row.externalId,
    // Flattened for a single shared shape between CSV and JSON — the ids
    // themselves are still meaningful only within the same export.
    matchedLotIds: row.matchedLotIds === null ? null : row.matchedLotIds.join(';'),
    note: row.note,
  };
}

export function toJson(rows: readonly LedgerExportRow[]): string {
  return JSON.stringify(rows.map(toExportRecord), null, 2);
}

/** RFC 4180: quote a field containing a comma, a quote, or a line break; double up any quote inside it. */
function csvCell(value: string | null): string {
  if (value === null) return '';
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly LedgerExportRow[]): string {
  const header = COLUMNS.join(',');
  const lines = rows.map((row) => {
    const record = toExportRecord(row);
    return COLUMNS.map((column) => csvCell(record[column])).join(',');
  });
  return [header, ...lines].join('\r\n');
}
