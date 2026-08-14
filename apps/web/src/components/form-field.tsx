import { type ReactNode } from 'react';

import { Label } from '@/components/ui/label';

export function errorId(field: string): string {
  return `${field}-error`;
}

/**
 * One field's label, control and errors. The wiring — `htmlFor`, `aria-invalid`,
 * `aria-describedby` — is the whole reason this exists: done per-field by hand it
 * is done inconsistently, and a validation message no screen reader announces is
 * not a validation message.
 */
export function Field({
  name,
  label,
  hint,
  errors,
  children,
}: Readonly<{
  name: string;
  label: string;
  hint?: string;
  errors: readonly string[] | undefined;
  children: ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint !== undefined && <p className="text-muted-foreground text-xs">{hint}</p>}
      {errors !== undefined &&
        errors.map((message) => (
          <p key={message} id={errorId(name)} role="alert" className="text-destructive text-xs">
            {message}
          </p>
        ))}
    </div>
  );
}
