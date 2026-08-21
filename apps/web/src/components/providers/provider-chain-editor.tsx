'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { setInstrumentChainAction } from '@/app/(app)/more/providers/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n/client';
import { PROVIDER_LABELS } from '@/lib/provider-labels';
import { cn } from '@/lib/utils';

/** One chain entry as shown here — admin-visible fields already formatted server-side (`formatInstant`), so this component stays free of `Temporal`. */
export interface ChainEntryView {
  readonly provider: string;
  readonly symbol: string;
  readonly fallbackCount: number;
  readonly lastFallbackAt: string | null;
  readonly verifiedAt: string;
}

/**
 * The admin mapping editor (Stage 5): reorder, edit a symbol, remove an
 * entry, or add one from whatever the instrument's kind can still use — then
 * one `Save` replaces the whole chain in a single call
 * (`setInstrumentChainAction` → `setChain`, not a sequence of granular
 * edits). Same `useTransition` + direct server-action-call shape as
 * `<FxSourceSettings>`, chosen over `useActionState` because the entry count
 * is dynamic — there is no fixed set of named fields a `FormData` submit
 * could carry.
 */
export function ProviderChainEditor({
  instrumentId,
  initialChain,
  availableProviders,
}: Readonly<{
  instrumentId: string;
  initialChain: readonly ChainEntryView[];
  availableProviders: readonly string[];
}>) {
  const { dictionary } = useI18n();
  const strings = dictionary.providers;

  const [entries, setEntries] = useState(
    initialChain.map((entry) => ({ provider: entry.provider, symbol: entry.symbol })),
  );
  const [info] = useState(new Map(initialChain.map((entry) => [entry.provider, entry])));
  const [draftProvider, setDraftProvider] = useState('');
  const [draftSymbol, setDraftSymbol] = useState('');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const unusedProviders = availableProviders.filter(
    (provider) => !entries.some((entry) => entry.provider === provider),
  );

  function move(index: number, direction: -1 | 1): void {
    setMessage(null);
    setEntries((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function remove(index: number): void {
    setMessage(null);
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSymbol(index: number, symbol: string): void {
    setEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, symbol } : entry)));
  }

  function add(): void {
    if (draftProvider === '' || draftSymbol.trim() === '') return;
    setMessage(null);
    setEntries((prev) => [...prev, { provider: draftProvider, symbol: draftSymbol.trim() }]);
    setDraftProvider('');
    setDraftSymbol('');
  }

  function save(): void {
    setMessage(null);
    startTransition(async () => {
      const result = await setInstrumentChainAction(instrumentId, entries);
      setMessage(
        result.ok
          ? { kind: 'success', text: strings.saved }
          : { kind: 'error', text: result.error ?? strings.genericError },
      );
    });
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{strings.chainTitle}</h2>
        <p className="text-muted-foreground text-xs">{strings.chainSubtitle}</p>
      </header>

      {entries.length > 0 && (
        <ul className="divide-border flex flex-col divide-y border-y">
          {entries.map((entry, index) => {
            const entryInfo = info.get(entry.provider);
            return (
              <li key={entry.provider} className="flex items-start gap-3 py-3">
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={strings.moveUp}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === entries.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={strings.moveDown}
                  >
                    <ArrowDown />
                  </Button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {PROVIDER_LABELS[entry.provider as keyof typeof PROVIDER_LABELS] ??
                      entry.provider}
                  </div>
                  <Input
                    value={entry.symbol}
                    onChange={(event) => updateSymbol(index, event.target.value)}
                    className="mt-1 h-8 max-w-xs"
                    aria-label={strings.symbolLabel}
                  />
                  {entryInfo !== undefined && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {strings.fallbackCount}: {entryInfo.fallbackCount} · {strings.lastFallbackAt}:{' '}
                      {entryInfo.lastFallbackAt ?? strings.never} · {strings.verifiedAt}:{' '}
                      {entryInfo.verifiedAt}
                    </p>
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label={strings.removeButton}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {unusedProviders.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{strings.providerLabel}</span>
            <Select
              value={draftProvider}
              onValueChange={(value) => setDraftProvider(value as string)}
              items={unusedProviders.map((provider) => ({
                value: provider,
                label: PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider,
              }))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={strings.providerLabel} />
              </SelectTrigger>
              <SelectContent>
                {unusedProviders.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{strings.symbolLabel}</span>
            <Input
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value)}
              className="h-9 w-40"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={add}
            disabled={draftProvider === '' || draftSymbol.trim() === ''}
          >
            <Plus /> {strings.addButton}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{strings.noProvidersLeft}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? strings.saving : strings.saveButton}
        </Button>
        {message !== null && (
          <p
            className={cn(
              'text-xs',
              message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
