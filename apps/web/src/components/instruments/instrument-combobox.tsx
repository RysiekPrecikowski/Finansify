'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { searchInstrumentsAction, type InstrumentOption } from '@/app/(app)/transactions/actions';
import { errorId, Field } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/client';

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

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
 * Search-as-you-type instrument selection. The user never sees "add a new
 * instrument" as a separate step — typing a ticker or a name and picking a
 * row from the list is the entire flow, whether that row already exists in
 * our database or comes from the provider. What gets submitted is always one
 * of `<InstrumentOption>`'s two shapes as hidden fields, never free text
 * (`actions.ts`'s `resolveInstrumentSelection` accepts nothing else).
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
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  /**
   * `autoSelectIfSingle` only ever fires from the seeded-query mount effect
   * below, never from a keystroke — auto-picking while the user is still
   * typing would select out from under them before they finished. The seeded
   * query is the parser's own normalized ticker (`XTB.PL` → `XTB.WA`), so a
   * single hit whose own symbol matches that query exactly is as trustworthy
   * as the bulk auto-match screen's pre-checked exact hits; anything looser
   * (multiple results, or a fuzzy single result for a different symbol) still
   * waits for a click, same as before.
   */
  function runSearch(trimmed: string, autoSelectIfSingle = false) {
    startTransition(async () => {
      const results = await searchInstrumentsAction(trimmed);
      if (
        autoSelectIfSingle &&
        results.length === 1 &&
        leadingSymbol(results[0]!.label).toUpperCase() === trimmed.toUpperCase()
      ) {
        onPick(results[0]!);
        return;
      }
      setOptions(results);
      setOpen(true);
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
      setOptions([]);
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
          {isPending && (
            <li className="text-muted-foreground px-3 py-2 text-sm">{strings.searching}</li>
          )}
          {!isPending && options.length === 0 && (
            <li className="text-muted-foreground px-3 py-2 text-sm">{strings.noResults}</li>
          )}
          {!isPending &&
            options.map((option) => (
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
