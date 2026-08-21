'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { errorId, Field } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/client';
import { MIN_QUERY_LENGTH, type InstrumentOption } from '@/lib/instrument-search-shared';

const DEBOUNCE_MS = 250;
const SEARCH_URL = '/api/instruments/search';

/**
 * What the combobox already has a selection for — either an existing row
 * (editing a transaction whose instrument is already resolved) or nothing
 * (a fresh form). There is no "typed but unconfirmed" initial state: a
 * transaction is never saved with an instrument the user didn't pick from
 * this list.
 */
export type InstrumentComboboxInitial =
  | { readonly kind: 'existing'; readonly instrumentId: string; readonly label: string }
  /**
   * A search seeded but not yet answered for — the import resolve screen's
   * fallback, where the parser already knows a normalized ticker (e.g. a
   * broker's raw `XTB.PL` turned into the market symbol `XTB.WA`) but nothing
   * has been picked from the results yet. Runs once on mount; a single result
   * whose own symbol matches the seeded query exactly is selected right away
   * (the normalized ticker is already a high-confidence guess — requiring a
   * click to confirm what is visibly the only possible answer reads as
   * broken, not as a safety check), anything less exact still waits for one.
   */
  | { readonly kind: 'query'; readonly text: string }
  | null;

/**
 * Search-as-you-type instrument selection. Everything the search fans out to
 * — the local database, every registered `InstrumentSearchProvider`,
 * Catalyst bonds — lives behind one endpoint (`app/api/instruments/search`),
 * which streams a line of results the moment each source settles; this
 * component never learns how many sources there are or what they're called,
 * only that a batch of options arrived or the stream closed. A trailing
 * spinner shows for as long as the stream stays open, so "still searching"
 * is always visible rather than the list silently being incomplete.
 *
 * A new query aborts whatever request is still in flight rather than letting
 * it keep writing into the list once a newer one has started — without this
 * a slow response for an old keystroke can land after a fast response for
 * the current one and stay on screen.
 *
 * The user never sees "add a new instrument" as a separate step — typing a
 * ticker or a name and picking a row from the list is the entire flow,
 * whether that row already exists in our database or comes from a provider.
 * What gets submitted is always one of `<InstrumentOption>`'s shapes as
 * hidden fields, never free text (`actions.ts`'s `resolveInstrumentSelection`
 * accepts nothing else).
 */
export function InstrumentCombobox({
  initial,
  errors,
}: Readonly<{
  initial: InstrumentComboboxInitial;
  errors: readonly string[] | undefined;
}>) {
  const { dictionary } = useI18n();
  const strings = dictionary.transactions.instrumentSearch;

  const [query, setQuery] = useState(
    initial?.kind === 'existing' ? initial.label : (initial?.text ?? ''),
  );
  const [selection, setSelection] = useState<InstrumentOption | null>(
    initial?.kind === 'existing' ? { ...initial } : null,
  );
  const [options, setOptions] = useState<readonly InstrumentOption[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // Set only for the mount-time seeded search below; checked once the stream
  // for that run has closed, since "is this the only result" can't be known
  // while more might still arrive.
  const autoSelectRef = useRef<{ readonly trimmed: string; done: boolean } | null>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Aborts whatever request is still running if the component goes away
  // mid-search — otherwise its `setState` calls would fire after unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Fires once the current search's stream has closed — the only point at
  // which "exactly one result, matching the seeded query" can actually be
  // known.
  useEffect(() => {
    const pending = autoSelectRef.current;
    if (pending === null || pending.done || streaming) return;
    pending.done = true;

    if (
      options.length === 1 &&
      leadingSymbol(options[0]!.label).toUpperCase() === pending.trimmed.toUpperCase()
    ) {
      onPick(options[0]!);
    }
    // `options` deliberately excluded: this effect reacts to `streaming`
    // reaching false, not to every options update along the way, and reads
    // the latest `options` via closure at that moment.
  }, [streaming]);

  function runSearch(trimmed: string, autoSelectIfSingle = false) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    autoSelectRef.current = autoSelectIfSingle ? { trimmed, done: false } : null;
    setOptions([]);
    setStreaming(true);
    setOpen(true);

    // `AbortController.abort()` stops the network layer but does not
    // guarantee an in-flight `reader.read()` rejects before it resolves with
    // data the browser had already buffered — so a stale request's own
    // batches can still arrive after a newer search has reset `options`.
    // Both callbacks re-check which controller is current before touching
    // state, which is what an aborted request's leftover writes actually
    // need guarding against.
    void readSearchStream(trimmed, controller.signal, (batch) => {
      if (abortRef.current !== controller) return;
      setOptions((prev) => [...prev, ...batch]);
    }).finally(() => {
      if (abortRef.current === controller) setStreaming(false);
    });
  }

  // Runs once for a `kind: 'query'` initial — the import resolve screen's own
  // seeded search, so a group whose parser-normalized ticker is already
  // search-ready shows results immediately instead of an empty box waiting
  // for the user to type the exact thing the parser already knows.
  useEffect(() => {
    if (initial?.kind === 'query' && initial.text.trim().length >= MIN_QUERY_LENGTH) {
      runSearch(initial.text.trim(), true);
    }
    // Mount-time only, by design: `initial` seeds this instance once and is
    // never expected to change under the same component.
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    setSelection(null);
    clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      autoSelectRef.current = null;
      setOptions([]);
      setStreaming(false);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
  }

  function onPick(option: InstrumentOption) {
    setSelection(option);
    setQuery(option.label);
    setOpen(false);
  }

  const fieldId = 'instrumentSearch';

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2">
      <Field name={fieldId} label={strings.label} errors={errors}>
        <Input
          id={fieldId}
          name={fieldId}
          type="text"
          autoComplete="off"
          placeholder={strings.placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            if (options.length > 0) setOpen(true);
          }}
          aria-invalid={errors !== undefined && errors.length > 0}
          aria-describedby={
            errors !== undefined && errors.length > 0 ? errorId(fieldId) : undefined
          }
          aria-expanded={open}
          role="combobox"
          aria-autocomplete="list"
        />
      </Field>

      {open && (
        <ul className="bg-popover border-border absolute top-full z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border py-1 shadow-md">
          {options.length === 0 && streaming && (
            <li className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {strings.searching}
            </li>
          )}
          {options.length === 0 && !streaming && (
            <li className="text-muted-foreground px-3 py-2 text-sm">{strings.noResults}</li>
          )}
          {options.map((option) => (
            <li key={optionKey(option)}>
              <button
                type="button"
                className="hover:bg-accent hover:text-accent-foreground w-full px-3 py-2 text-left text-sm"
                onClick={() => onPick(option)}
              >
                {option.label}
              </button>
            </li>
          ))}
          {/* Some results already showing, but the stream is still open —
              a trailing row rather than replacing the list, so what's
              already found stays visible while the rest keeps loading. */}
          {options.length > 0 && streaming && (
            <li className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {strings.searchingMore}
            </li>
          )}
        </ul>
      )}

      {/* What actually gets submitted — never the free-text query above, and
          never a descriptive field. Only which listing was picked travels;
          kind, exchange and currency are re-derived server-side by `confirm()`,
          because `instruments` is global and a field asserted here would be
          persisted once and then served to everyone. */}
      {selection !== null && (
        <>
          <input type="hidden" name="instrumentSelectionKind" value={selection.kind} />
          {selection.kind === 'existing' && (
            <input type="hidden" name="instrumentId" value={selection.instrumentId} />
          )}
          {/* A bond submits only its series code. Everything else about it —
              family, tenor, rates, fees — is derived server-side from that
              code plus the trade date, so there is nothing here for a client
              to assert. */}
          {selection.kind === 'bond' && (
            <input type="hidden" name="instrumentSeriesCode" value={selection.seriesCode} />
          )}
          {/* A Catalyst bond submits only its ticker — `selectCatalystBond`
              looks it up again server-side to get the ISIN, issuer and
              nominal, same reasoning as a treasury bond's series code. */}
          {selection.kind === 'catalyst_bond' && (
            <input type="hidden" name="instrumentTicker" value={selection.ticker} />
          )}
          {selection.kind === 'candidate' && (
            <>
              <input type="hidden" name="instrumentProvider" value={selection.provider} />
              <input type="hidden" name="instrumentSymbol" value={selection.symbol} />
              <input type="hidden" name="instrumentName" value={selection.name} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Reads the search endpoint's NDJSON stream, calling `onBatch` for each
 * line as it arrives. Resolves once the stream closes; an aborted request
 * (a newer search started, or the component unmounted) resolves quietly
 * rather than throwing, since that is the expected way for this to end.
 */
async function readSearchStream(
  query: string,
  signal: AbortSignal,
  onBatch: (options: readonly InstrumentOption[]) => void,
): Promise<void> {
  try {
    const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}`, { signal });
    const body = response.body;
    if (!response.ok || body === null) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') continue;
        const batch = JSON.parse(line) as { readonly options: readonly InstrumentOption[] };
        onBatch(batch.options);
      }
    }
  } catch (error) {
    if ((error as { name?: string }).name !== 'AbortError') {
      console.error('Instrument search failed', error);
    }
  }
}

function optionKey(option: InstrumentOption): string {
  switch (option.kind) {
    case 'existing':
      return `existing:${option.instrumentId}`;
    case 'bond':
      return `bond:${option.seriesCode}`;
    case 'catalyst_bond':
      return `catalyst_bond:${option.ticker}`;
    default:
      return `candidate:${option.provider}:${option.symbol}`;
  }
}

/** `label` is always `"<symbol> · <name>[ (<exchange>)]"` for both option kinds. */
function leadingSymbol(label: string): string {
  return label.split(' · ')[0] ?? label;
}
