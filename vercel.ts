import type { VercelConfig } from '@vercel/config/v1';

// Root Directory (apps/web) is not expressible here — Vercel only exposes it
// as a dashboard/Project Settings field, never through vercel.json or
// vercel.ts. This file covers what actually is configurable in code.
export const config: VercelConfig = {
  ignoreCommand: 'npx turbo-ignore',
};
