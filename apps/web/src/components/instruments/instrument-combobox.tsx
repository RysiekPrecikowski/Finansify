'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  searchBankierAction,
  searchCatalystBondsAction,
  searchExistingAction,
  searchYahooAction,
  type InstrumentOption,
} from '@/app/(app)/transactions/actions';
import { errorId, Field } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/client';

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * The independent sources a search fans out to, in display order. Order here
 * is purely cosmetic — each source is self-consistent on its own (see
 * `actions.ts`), so nothing about correctness depends on it.
 */
const SOURCES = ['existing', 'catalyst_bond', 'yahoo', 'bankier'] as const;
type Source = (typeof SOURCES)[number];

const FETCHERS: Readonly<Record<Source, (query: string) => Promise<readonly InstrumentOption[]>>> =
  {
    existing: searchExistingAction,
    catalyst_bond: searchCatalystBondsAction,
    yahoo: searchYahooAction,
    bankier: searchBankierAction,
  };

const EMPTY_RESULTS: Readonly<Record<Source, readonly InstrumentOption[]>> = {
  existing: [],
  catalyst_bond: [],
  yahoo: [],
  bankier: [],
};

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
 * Search-as-you-type instrument selection, fanned out to four independent
 * sources (`SOURCES`) that each answer on their own schedule — a slow one
 * (in practice `gpwcatalyst.pl`'s uncached listing page, but nothing here
 * hard-codes that) must never hold up results a fast one already has.
 * Results are merged into the list as each source answers; a trailing
 * spinner row shows while any source is still out, so "still searching" is
 * always visible rather than the list silently being incomplete.
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
  const [resultsBySource, setResultsBySource] =
    useState<Readonly<Record<Source, readonly InstrumentOption[]>>>(EMPTY_RESULTS);
  const [pendingSources, setPendingSources] = useState<ReadonlySet<Source>>(new Set());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchTokenRef = useRef(0);
  // Set only for the mount-time seeded search below; checked once every
  // source for that run has answered, since "is this the only result" can't
  // be known from any single source in isolation.
  const autoSelectRef = useRef<{ readonly trimmed: string; done: boolean } | null>(null);

  const options = SOURCES.flatMap((source) => resultsBySource[source]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Fires once all four sources for the current search have answered — the
  // only point at which "exactly one result, matching the seeded query" can
  // actually be known.
  useEffect(() => {
    const pending = autoSelectRef.current;
    if (pending === null || pending.done || pendingSources.size > 0) return;
    pending.done = true;

    if (
      options.length === 1 &&
      leadingSymbol(options[0]!.label).toUpperCase() === pending.trimmed.toUpperCase()
    ) {
      onPick(options[0]!);
    }
    // `options`/`resultsBySource` deliberately excluded: this effect reacts to
    // `pendingSources` reaching empty, not to every options update along the
    // way, and reads the latest `options` via closure at that moment.
  }, [pendingSources]);

  function runSearch(trimmed: string, autoSelectIfSingle = false) {
    const token = ++searchTokenRef.current;
    autoSelectRef.current = autoSelectIfSingle ? { trimmed, done: false } : null;
    setResultsBySource(EMPTY_RESULTS);
    setPendingSources(new Set(SOURCES));
    setOpen(true);

    for (const source of SOURCES) {
      FETCHERS[source](trimmed)
        .then((results) => {
          if (searchTokenRef.current !== token) return;
          setResultsBySource((prev) => ({ ...prev, [source]: results }));
        })
        .finally(() => {
          if (searchTokenRef.current !== token) return;
          setPendingSources((prev) => {
            if (!prev.has(source)) return prev;
            const next = new Set(prev);
            next.delete(source);
            return next;
          });
        });
    }
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
      searchTokenRef.current += 1; // invalidate any in-flight search
      autoSelectRef.current = null;
      setResultsBySource(EMPTY_RESULTS);
      setPendingSources(new Set());
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
  const stillSearching = pendingSources.size > 0;

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
          {options.length === 0 && stillSearching && (
            <li className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {strings.searching}
            </li>
          )}
          {options.length === 0 && !stillSearching && (
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
          {/* Some results already showing, but not every source has answered
              yet — a trailing row rather than replacing the list, so what's
              already found stays visible while the rest keeps loading. */}
          {options.length > 0 && stillSearching && (
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
