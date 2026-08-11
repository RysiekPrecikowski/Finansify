import { ClerkProvider } from '@clerk/nextjs';
import { type ReactNode } from 'react';

/**
 * The root layout wraps the app in this rather than importing `ClerkProvider`
 * itself — this directory is the only one permitted to import `@clerk/nextjs`
 * (ADR 0009, rule 2), so even the provider component is re-exported from here
 * under our own name.
 */
export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
