/**
 * Yahoo's own listing conventions, section 06 of the ingestion plan. `suffix`
 * builds the candidate symbol from our own `(symbol, exchange)`; `code` is
 * the short code `quote().exchange` returns for that market, which is the
 * hard gate a resolved mapping must pass (never `fullExchangeName` — that's
 * a display string, and this is a stable identifier).
 *
 * Keys are MIC codes (ISO 10383) — `instruments.exchange` is expected to
 * hold one. An instrument on an exchange not listed here cannot be
 * auto-resolved and queues for the manual mapping screen (PR 6).
 */
export interface YahooExchange {
  readonly suffix: string;
  readonly code: string;
}

export const MIC_TO_YAHOO: Readonly<Record<string, YahooExchange>> = {
  XWAR: { suffix: '.WA', code: 'WSE' },
  XETR: { suffix: '.DE', code: 'GER' },
  XLON: { suffix: '.L', code: 'LSE' },
  XAMS: { suffix: '.AS', code: 'AMS' },
  XMIL: { suffix: '.MI', code: 'MIL' },
  XNAS: { suffix: '', code: 'NMS' },
  XNYS: { suffix: '', code: 'NYQ' },
};
