'use client';

import { useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';

import { setFxScope, setFxSource } from '@/lib/display/actions';
import {
  fxScopeOptions,
  fxSourceOptions,
  type FxPreference,
  type FxScopeOption,
  type FxSourceOption,
} from '@/lib/display/currencies';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/**
 * Where FX rates come from, and how far that choice reaches (ADR 0018).
 *
 * Two groups rather than one list of four combinations: source and scope are
 * independent questions, and flattening them would hide that `charts` keeps the
 * portfolio on NBP whichever source is selected.
 *
 * The divergence warning is shown **here, at the moment of choosing**, and
 * again wherever a diverging total is rendered. A consequence disclosed once in
 * a settings screen is consent in name only.
 */
export function FxSourceSettings({ preference }: Readonly<{ preference: FxPreference }>) {
  const { dictionary } = useI18n();
  const strings = dictionary.settings;
  const [pending, startTransition] = useTransition();

  const diverges = preference.source === 'yahoo' && preference.scope === 'all';

  return (
    <section className="flex max-w-md flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{strings.fxTitle}</h2>
        <p className="text-muted-foreground text-xs">{strings.fxSubtitle}</p>
      </header>

      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="text-muted-foreground mb-1 text-xs font-medium">
          {strings.fxSourceLabel}
        </legend>
        {fxSourceOptions.map((option: FxSourceOption) => (
          <Choice
            key={option}
            checked={preference.source === option}
            name="fx-source"
            title={strings.fxSourceNames[option]}
            note={strings.fxSourceNotes[option]}
            onSelect={() => {
              startTransition(async () => {
                await setFxSource(option);
              });
            }}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="text-muted-foreground mb-1 text-xs font-medium">
          {strings.fxScopeLabel}
        </legend>
        {fxScopeOptions.map((option: FxScopeOption) => (
          <Choice
            key={option}
            checked={preference.scope === option}
            name="fx-scope"
            title={strings.fxScopeNames[option]}
            note={strings.fxScopeNotes[option]}
            onSelect={() => {
              startTransition(async () => {
                await setFxScope(option);
              });
            }}
          />
        ))}
      </fieldset>

      {/* Not red: `docs/ui.md` reserves red for loss. This is a consequence to
          understand, not a number that went the wrong way. */}
      {diverges && (
        <p className="text-muted-foreground flex gap-2 rounded-md border p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{strings.fxDivergesWarning}</span>
        </p>
      )}
    </section>
  );
}

function Choice({
  checked,
  name,
  title,
  note,
  onSelect,
}: Readonly<{
  checked: boolean;
  name: string;
  title: string;
  note: string;
  onSelect: () => void;
}>) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
        checked ? 'bg-muted/50' : 'hover:bg-muted/30',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-4 shrink-0 accent-current"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{note}</span>
      </span>
    </label>
  );
}
